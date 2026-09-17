import { useEffect, useId, useRef, useState } from 'react';
import Icon from './WorkspaceIcon';

export function PageHeading({ title, description, children }) {
  return <header className="ux-page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{children && <div className="ux-heading-actions">{children}</div>}</header>;
}

export function EmptyState({ icon = 'grid', title, children, action }) {
  return <div className="ux-empty"><span className="ux-empty-icon"><Icon name={icon} /></span><h3>{title}</h3>{children && <p>{children}</p>}{action && <div>{action}</div>}</div>;
}

export function Notice({ children, error = false, action }) {
  return <div className={`ux-notice${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}><Icon name={error ? 'alert' : 'check'} /><span>{children}</span>{action}</div>;
}

export function useConfirmDialog() {
  const [question, setQuestion] = useState(null);
  const dialogRef = useRef(null);
  const resolver = useRef(null);
  const titleId = useId();
  useEffect(() => { if (question && !dialogRef.current?.open) dialogRef.current?.showModal(); }, [question]);
  useEffect(() => () => { resolver.current?.(false); }, []);
  const finish = answer => {
    dialogRef.current?.close();
    resolver.current?.(answer); resolver.current = null; setQuestion(null);
  };
  const confirm = options => new Promise(resolve => {
    resolver.current?.(false); resolver.current = resolve; setQuestion(options);
  });
  const dialog = <dialog ref={dialogRef} className="ux-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); finish(false); }}>
    {question && <><div className={`ux-dialog-symbol${question.danger ? ' is-danger' : ''}`}><Icon name={question.danger ? 'alert' : 'check'} /></div><h2 id={titleId}>{question.title}</h2><p>{question.description}</p>
      <div className="ux-dialog-actions"><button type="button" className="btn-secondary" autoFocus onClick={() => finish(false)}>Cancel</button><button type="button" className={question.danger ? 'btn-danger' : 'btn-primary'} onClick={() => finish(true)}>{question.label || 'Continue'}</button></div></>}
  </dialog>;
  return { confirm, dialog };
}

export function ActionMenu({ label, children }) {
  const trigger = useRef(null);
  const panel = useRef(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  // React 18 does not forward the native popover toggle event on a div.
  useEffect(() => {
    const element = panel.current;
    const sync = () => setOpen(element.matches(':popover-open'));
    element.addEventListener('toggle', sync);
    return () => element.removeEventListener('toggle', sync);
  }, []);
  const close = () => { panel.current?.hidePopover(); trigger.current?.focus(); };
  const toggle = () => {
    if (panel.current.matches(':popover-open')) { close(); return; }
    panel.current.showPopover();
    const box = trigger.current.getBoundingClientRect();
    const height = panel.current.offsetHeight;
    panel.current.style.left = `${Math.max(12, Math.min(box.right - 215, innerWidth - 227))}px`;
    panel.current.style.top = `${Math.max(12, box.bottom + height + 12 > innerHeight ? box.top - height - 6 : box.bottom + 6)}px`;
  };
  return <div className="ux-action-menu"><button ref={trigger} type="button" className="ux-menu-trigger" aria-label={label} title={label} aria-expanded={open} aria-controls={id} onClick={toggle}><Icon name="more" /></button>
    <div id={id} ref={panel} popover="auto" className="ux-action-popover" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }} onClick={event => { if (event.target.closest('button:not(:disabled)')) close(); }}>{children}</div>
  </div>;
}
