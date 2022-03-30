import { createPartitionedMessageRow, isGuildBasedChannel, isMessageButtonInteraction, isMessageInstance, PaginatedMessage, PaginatedMessageAction, PaginatedMessagePage, runsOnInteraction } from "@sapphire/discord.js-utilities";
import { isFunction } from "@sapphire/utilities";
import { ButtonInteraction, CommandInteraction, Constants, ContextMenuInteraction, Message, MessageButton, MessageOptions, MessageSelectMenu, SelectMenuInteraction, User, WebhookEditMessageOptions } from "discord.js";

/**
 * Taken from Skyra
 * @see https://github.com/skyra-project/skyra/blob/main/src/lib/structures/HelpPaginatedMessage.ts
 */
export class SapphireTemplatePaginatedMessage extends PaginatedMessage {

    public override addPage(page: PaginatedMessagePage): this {
        this.pages.push(page);
        return this;
    }

    protected async setUpMessage(
        messageOrInteraction: Message | CommandInteraction | ContextMenuInteraction | SelectMenuInteraction | ButtonInteraction,
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
            for (const interaction of this.actions.values() as IterableIterator<PaginatedMessageAction>) {
                if (isMessageButtonInteraction(interaction)) {
                    messageComponents.push(new MessageButton(interaction));
                } else if (interaction.type === Constants.MessageComponentTypes.SELECT_MENU && interaction.customId === '@sapphire/paginated-messages.goToPage') {
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
