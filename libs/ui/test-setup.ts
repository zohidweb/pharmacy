/*
 * Jest setup for libs/ui: axe matcher (ADR-0009, ось Е) and minimal stand-ins for platform APIs
 * that jsdom does not implement (<dialog> modality, Popover API). Browsers provide the real ones.
 */
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

const dialogProto = HTMLDialogElement.prototype as HTMLDialogElement & {
  showModal?: () => void;
};
if (!dialogProto.showModal) {
  dialogProto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  dialogProto.show = function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  dialogProto.close = function close(
    this: HTMLDialogElement,
    returnValue?: string,
  ) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event('close'));
  };
}

const elementProto = HTMLElement.prototype as HTMLElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
  togglePopover?: (force?: boolean) => boolean;
};
if (!elementProto.showPopover) {
  const open = new WeakSet<HTMLElement>();
  const toggle = (el: HTMLElement, next: boolean) => {
    const wasOpen = open.has(el);
    if (wasOpen === next) return;
    if (next) open.add(el);
    else open.delete(el);
    el.toggleAttribute('data-popover-open', next);
    const event = new Event('toggle') as Event & {
      newState: string;
      oldState: string;
    };
    event.newState = next ? 'open' : 'closed';
    event.oldState = wasOpen ? 'open' : 'closed';
    el.dispatchEvent(event);
  };
  elementProto.showPopover = function showPopover(this: HTMLElement) {
    toggle(this, true);
  };
  elementProto.hidePopover = function hidePopover(this: HTMLElement) {
    toggle(this, false);
  };
  elementProto.togglePopover = function togglePopover(
    this: HTMLElement,
    force?: boolean,
  ) {
    const next = force ?? !open.has(this);
    toggle(this, next);
    return next;
  };
}
