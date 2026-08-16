/**
 * dsh-lynel-plugin — browser half entry.
 *
 * Registers three contributions into existing DSH slots (zero patching):
 *
 *  1. `conversation.composer`  (chain, priority -100) — AskUserQuestion HTTP
 *     hook: forwards the question batch to the Lynel backend and answers the
 *     wait from its reply (fallback: inline manual answering).
 *  2. `conversation.session.header.actions` (list) — the "绑定 Bot" button.
 *  3. `shell.overlay` (list) — the bind modal.
 *
 * Plus the trajectory forwarder: a second mux stream maps every session event
 * to a LynelEnvelope and pushes it to the Lynel backend.
 */

import { startEnvelopeForwarder } from './envelope';
import { AskHookPanel, selectQuestion } from './ask-hook';
import { BindHeaderButton, BindModal, installBindEvent } from './bind-ui';
import { BotsSettingsSection } from './bots-settings';
import { BotBadge } from './bot-badge';
import { refreshBotDoc } from './bots-store';
import type { DshCtx, RegisterOptions } from './types';

/** Cordis services required by this client plugin. */
export const inject = ['connection', 'slots'];

/**
 * Client plugin body.
 * @param ctx - client root context (connection + slots provided).
 */
export function apply(ctx: DshCtx): void {
  // 1. trajectory → LynelEnvelope forwarder
  ctx.effect(
    () => startEnvelopeForwarder(ctx),
    'dsh-lynel-plugin: envelope forwarder',
  );

  // 1b. prime the shared bot-document cache (header badge / settings page)
  void refreshBotDoc();

  // 2. UI contributions (wait for the declaring slot to land on the ledger)
  ctx.effect(() => {
    const disposers: Array<() => void> = [];

    disposers.push(
      ctx.slots.inject('conversation.composer', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer',
            select: selectQuestion,
            priority: -100,
          } satisfies RegisterOptions,
          AskHookPanel,
        ),
      ),
    );

    disposers.push(
      ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.actions',
            id: 'lynel-bind-bot',
            order: 1000,
          } satisfies RegisterOptions,
          BindHeaderButton,
        ),
      ),
    );

    disposers.push(
      ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.actions',
            id: 'lynel-bot-badge',
            order: 990,
          } satisfies RegisterOptions,
          BotBadge,
        ),
      ),
    );

    disposers.push(
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'lynel-bind-modal',
            order: 100,
          } satisfies RegisterOptions,
          BindModal,
        ),
      ),
    );

    disposers.push(
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'lynel-bots',
            order: 20,
            label: () => 'Bot 设置',
          } satisfies RegisterOptions,
          BotsSettingsSection,
        ),
      ),
    );

    // 3. window event from the optional ui-workspace row-menu patch
    disposers.push(installBindEvent(window));

    return () => {
      for (const dispose of disposers) dispose();
    };
  }, 'dsh-lynel-plugin: bind-bot UI');
}
