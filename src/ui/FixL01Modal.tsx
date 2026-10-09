import { useMemo, useState } from 'react';
import { Alert, Button, Modal, Text } from '@capra/core';
import { applyRouteOrder } from '../api/routes';
import { diffReach } from '../diff/diff';
import type { L01FixPlan } from '../fix/l01';
import type { Inventory } from '../model/types';
import ReachChanges from './ReachChanges';

interface Props {
  inventory: Inventory;
  plan: L01FixPlan | null;
  onClose: () => void;
  /** Called when the success dialog is closed, to reload the group's config. */
  onApplied: () => void;
}

type Status = { state: 'idle' } | { state: 'applying' } | { state: 'error'; message: string } | { state: 'done' };

function Order({ title, routes, movedIds, focusId }: { title: string; routes: L01FixPlan['before']; movedIds: Set<string>; focusId: string }) {
  return (
    <div className="order">
      <Text as="h3" variant="heading">{title}</Text>
      <ol>
        {routes.map((r) => (
          <li
            key={r.id}
            className={['order-item', movedIds.has(r.id) && 'is-moved', r.id === focusId && 'is-focus', r.disabled && 'is-disabled']
              .filter(Boolean)
              .join(' ')}
          >
            <span className="order-name">{`${r.index + 1}. ${r.name}`}</span>
            <code className="mono">{r.filter || '(empty)'}</code>
            <span className="order-meta">{`${r.final ? 'Final' : 'non-Final'}${r.disabled ? ' · disabled' : ''} → ${r.output ?? 'expression'}`}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function FixL01Modal({ inventory, plan, onClose, onApplied }: Props) {
  const group = inventory.group;
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  // What the reorder changes for each Source, read from the Route filters.
  const reach = useMemo(
    () => (plan ? diffReach(inventory, { ...inventory, routes: plan.after }) : []),
    [inventory, plan],
  );
  const close = () => {
    const applied = status.state === 'done';
    setStatus({ state: 'idle' });
    onClose();
    // Reload after closing: reloading unmounts the Linter tab, and this dialog with it.
    if (applied) onApplied();
  };

  const apply = async () => {
    if (!plan) return;
    setStatus({ state: 'applying' });
    try {
      await applyRouteOrder(group, plan.before.map((r) => r.id), plan.order);
      setStatus({ state: 'done' });
    } catch (e) {
      setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const movedIds = new Set(plan?.moves.map((m) => m.id) ?? []);
  const done = status.state === 'done';

  return (
    <Modal
      isOpen={plan !== null}
      onClose={close}
      size="lg"
      title={done ? 'Routes reordered' : `Fix L01: reorder routes in ${group}`}
      footer={
        done ? (
          <Button variant="primary" onClick={close}>Close</Button>
        ) : (
          <div className="modal-actions">
            <Button onClick={close} disabled={status.state === 'applying'}>Cancel</Button>
            <Button variant="primary" appearance="danger" pending={status.state === 'applying'} onClick={() => void apply()}>
              {`Reorder ${plan?.moves.length ?? 0} routes in ${group}`}
            </Button>
          </div>
        )
      }
    >
      {plan && (
        <div className="fix-body">
          {done ? (
            <Alert appearance="success" title="Saved as an uncommitted change">
              {`The Routing table in ${group} now has "${plan.shadowingName}" at position ${plan.order.indexOf(plan.shadowingId) + 1}. Review, commit, and deploy it in Cribl Stream to put it into effect. Blueprint never commits or deploys.`}
            </Alert>
          ) : (
            <>
              <Text>
                {`Blueprint will move "${plan.shadowingName}" below the routes it shadows. Moved routes are highlighted. This replaces the whole Routing table in ${group}; it is saved as an uncommitted change that you can review or discard in Cribl.`}
              </Text>
              <div className="order-grid">
                <Order title="Before" routes={plan.before} movedIds={movedIds} focusId={plan.shadowingId} />
                <Order title="After" routes={plan.after} movedIds={movedIds} focusId={plan.shadowingId} />
              </div>
              <div className="fix-reach">
                <Text as="h3" variant="heading">What changes for each Source</Text>
                <ReachChanges reach={reach} />
              </div>
              {plan.takesOver.length > 0 && (
                <Alert appearance="info" title="Routes that will start matching">
                  {`${plan.takesOver.join(', ')} will now receive the events they match, instead of "${plan.shadowingName}".`}
                </Alert>
              )}
              {plan.cloneWarnings.length > 0 && (
                <Alert appearance="warning" title="Non-Final routes will clone events">
                  {`${plan.cloneWarnings.join(', ')} ${plan.cloneWarnings.length === 1 ? 'is' : 'are'} not Final: events ${plan.cloneWarnings.length === 1 ? 'it matches' : 'they match'} will be processed there and also continue to "${plan.shadowingName}".`}
                </Alert>
              )}
              {status.state === 'error' && (
                <Alert appearance="danger" title="Nothing was changed">
                  {status.message}
                </Alert>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
