import { isGuildBasedChannel, isMessageButtonInteraction, isMessageInstance, PaginatedMessage, PaginatedMessageAction, PaginatedMessageOptions, PaginatedMessagePage, runsOnInteraction } from "@sapphire/discord.js-utilities";
import { isFunction } from "@sapphire/utilities";
import { ButtonInteraction, CommandInteraction, Constants, Message, MessageActionRow, MessageButton, MessageOptions, MessageSelectMenu, SelectMenuInteraction, User, WebhookEditMessageOptions } from "discord.js";

/**
 * Taken from Skyra
 * @see https://github.com/skyra-project/skyra/blob/main/src/lib/structures/HelpPaginatedMessage.ts
 */
export class SapphireTemplatePaginatedMessage extends PaginatedMessage {

    public constructor(options: PaginatedMessageOptions = {}) {
        super(options);

        this.setActions([
            {
                customId: '@sapphire/paginated-messages.goToPage',
                type: Constants.MessageComponentTypes.SELECT_MENU,
                selectMenuIndex: 'set-1',
                run: ({ handler, interaction }) => interaction.isSelectMenu() && (handler.index = parseInt(interaction.values[0], 10))
            },
            {
                customId: '@sapphire/paginated-messages.firstPage',
                style: 'PRIMARY',
                emoji: '⏪',
                type: Constants.MessageComponentTypes.BUTTON,
                run: ({ handler }) => (handler.index = 0)
            },
            {
                customId: '@sapphire/paginated-messages.previousPage',
                style: 'PRIMARY',
                emoji: '◀️',
                type: Constants.MessageComponentTypes.BUTTON,
                run: ({ handler }) => {
                    if (handler.index === 0) {
                        handler.index = handler.pages.length - 1;
                    } else {
                        --handler.index;
                    }
                }
            },
            {
                customId: '@sapphire/paginated-messages.nextPage',
                style: 'PRIMARY',
                emoji: '▶️',
                type: Constants.MessageComponentTypes.BUTTON,
                run: ({ handler }) => {
                    if (handler.index === handler.pages.length - 1) {
                        handler.index = 0;
                    } else {
                        ++handler.index;
                    }
                }
            },
            {
                customId: '@sapphire/paginated-messages.goToLastPage',
                style: 'PRIMARY',
                emoji: '⏩',
                type: Constants.MessageComponentTypes.BUTTON,
                run: ({ handler }) => (handler.index = handler.pages.length - 1)
            },
            {
                customId: '@sapphire/paginated-messages.stop',
                style: 'DANGER',
                emoji: '⏹️',
                type: Constants.MessageComponentTypes.BUTTON,
                run: ({ collector }) => {
                    collector.stop();
                }
            }
        ]);
    }

    public override setActions(actions: KelevraPaginatedMessageAction[]): this {
        this.actions.clear();
        return this.addActions(actions);
    }

    public override addPage(page: PaginatedMessagePage): this {
        this.pages.push(page);

        return this;
    }

    /**
     * Sets up the message.
     *
     * @param messageOrInteraction The message or interaction that triggered this {@link PaginatedMessage}.
     * Generally this will be the command message or an interaction
     * (either a {@link CommandInteraction}, a {@link SelectMenuInteraction} or a {@link ButtonInteraction}),
     * but it can also be another message from your client, i.e. to indicate a loading state.
     *
     * @param author The author the handler is for.
     */
    protected async setUpMessage(
        messageOrInteraction: Message | CommandInteraction | SelectMenuInteraction | ButtonInteraction,
        targetUser: User
    ): Promise<void> {
        // Get the current page
        let page = this.messages[this.index]!;

        // If the page is a callback function such as with `addAsyncPageEmbed` then resolve it here
        page = isFunction(page) ? await page(this.index, this.pages, this) : page;

        // Merge in the advanced options
        page = { ...page, ...(this.paginatedMessageData ?? {}) };

        // If we do not have more than 1 page then there is no reason to add message components
        if (this.pages.length > 1) {
            const messageComponents: (MessageButton | MessageSelectMenu)[] = [];

            for (const interaction of this.actions.values() as IterableIterator<KelevraPaginatedMessageAction>) {
                if (isMessageButtonInteraction(interaction)) {
                    messageComponents.push(new MessageButton(interaction));
                } else if (interaction.selectMenuIndex === 'set-1') {
                    if (this.pages.slice(25).length) { // Select page Menu by chunks to fit in 25 options only
                        const options = [];
                        const chunkSize = Math.round(this.pages.length / 25);
                        for (let i = 0; i < this.pages.length; i += chunkSize) {
                            if (options.length >= 25) break;

                            options.push({
                                label: `Page ${(i + 1).toString()}`,
                                value: (i).toString()
                            });
                        }
                        messageComponents.push(
                            new MessageSelectMenu({
                                options: options,
                                ...interaction
                            })
                        );
                    } else { // Standard Select Menu
                        messageComponents.push(
                            new MessageSelectMenu({
                                options: await Promise.all(
                                    this.pages.slice(0, 25).map(async (_, index) => ({
                                        ...(await this.selectMenuOptions(index + 1, {
                                            author: targetUser,
                                            channel: messageOrInteraction.channel,
                                            guild: isGuildBasedChannel(messageOrInteraction.channel) ? messageOrInteraction.channel.guild : null
                                        })),
                                        value: index.toString()
                                    }))
                                ),
                                ...interaction
                            })
                        );
                    }
                }
            }

            page.components = createPartitionedMessageRow(messageComponents);
        }

        if (this.response) {
            if (runsOnInteraction(this.response)) {
                if (this.response.replied || this.response.deferred) {
                    await this.response.editReply(page as WebhookEditMessageOptions);
                } else {
                    await this.response.reply(page as WebhookEditMessageOptions);
                }
            } else if (isMessageInstance(this.response)) {
                await this.response.edit(page as WebhookEditMessageOptions);
            }
        } else if (runsOnInteraction(messageOrInteraction)) {
            if (messageOrInteraction.replied || messageOrInteraction.deferred) {
                this.response = await messageOrInteraction.editReply(page);
            } else {
                this.response = await messageOrInteraction.reply({ ...page, fetchReply: true, ephemeral: false });
            }
        } else {
            this.response = await messageOrInteraction.channel.send(page as MessageOptions);
        }
    }
}

function createPartitionedMessageRow(components: (MessageButton | MessageSelectMenu)[]): MessageActionRow[] {
    // Sort all buttons above select menus
    components = components.sort((a, b) => (a.type === 'BUTTON' && b.type === 'SELECT_MENU' ? -1 : 0));

    const buttons = components.slice(0, 5);
    const selectMenu = components[5];

    // Map all the components to MessageActionRows
    const actionRows: MessageActionRow[] = [
        new MessageActionRow().setComponents(buttons), //
        new MessageActionRow().setComponents(selectMenu)
    ];

    return actionRows;
}

type KelevraPaginatedMessageAction = PaginatedMessageAction & {
    selectMenuIndex?: 'set-1' | 'set-2';
};