import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Alert, Button, EmptyState, Spinner, TabNav, Text } from '@capra/core';
import { listWorkerGroups, type WorkerGroup } from './api/groups';
import { lint } from './lint/runner';
import { applyRuleSettings, disabledRules } from './store/ruleSettings';
import { applySuppressions } from './store/suppressions';
import AsBuiltTab from './ui/AsBuiltTab';
import GroupPicker from './ui/GroupPicker';
import LinterTab from './ui/LinterTab';
import SnapshotsTab from './ui/SnapshotsTab';
import { useHostTheme } from './ui/theme';
import { useRuleSettings } from './ui/useRuleSettings';
import { useSuppressions } from './ui/useSuppressions';
import { useHealth } from './ui/useHealth';
import { useInventory } from './ui/useInventory';
import { useLineage } from './ui/useLineage';
import { useNodes } from './ui/useNodes';
import { useThroughput } from './ui/useThroughput';

// Dev-only tools (demo seeder, Phase 0 probe); the DEV guard lets Vite drop them from production.
const DevTools = import.meta.env.DEV ? lazy(() => import('./dev/DevTools')) : null;

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; groups: WorkerGroup[] };

type Tab = 'asbuilt' | 'linter' | 'snapshots';


function App() {
  const theme = useHostTheme();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [groupId, setGroupId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('asbuilt');
  const [showDev, setShowDev] = useState(false);
  const [inv, reloadInventory] = useInventory(groupId);
  const health = useHealth(groupId, inv.state === 'ready' ? inv.loadedAt : null);
  const throughput = useThroughput(groupId, inv.state === 'ready' ? inv.loadedAt : null);
  const nodes = useNodes(groupId, inv.state === 'ready' ? inv.loadedAt : null);
  const lineage = useLineage(load.state === 'ready' ? load.groups : null, inv.state === 'ready' ? inv.loadedAt : null);
  const suppressions = useSuppressions(groupId);
  const ruleSettings = useRuleSettings(groupId);
  // Rule settings apply before anything else, so every tab, count, and export follows them.
  const findings = useMemo(
    () => (inv.state === 'ready' ? applyRuleSettings(lint(inv.inventory, inv.graph), ruleSettings.doc) : []),
    [inv, ruleSettings.doc],
  );
  const split = useMemo(
    () => applySuppressions(findings, suppressions.doc, disabledRules(ruleSettings.doc)),
    [findings, suppressions.doc, ruleSettings.doc],
  );
  const tabs = [
    { key: 'asbuilt', name: 'As-Built' },
    {
      key: 'linter',
      name: inv.state === 'ready' && !suppressions.loading && !ruleSettings.loading ? `Linter (${split.active.length})` : 'Linter',
    },
    { key: 'snapshots', name: 'Snapshots' },
  ];

  useEffect(() => {
    const ctrl = new AbortController();
    listWorkerGroups(ctrl.signal)
      .then((groups) => {
        setLoad({ state: 'ready', groups });
        setGroupId((current) => current ?? groups[0]?.id ?? null);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setLoad({ state: 'error', message: String(e) });
      });
    return () => ctrl.abort();
  }, [attempt]);

  const group = load.state === 'ready' ? load.groups.find((g) => g.id === groupId) : undefined;
  const family =
    group?.kind === 'fleet' && load.state === 'ready'
      ? { parent: group.parent, subfleets: load.groups.filter((g) => g.parent === group.id).map((g) => g.id) }
      : undefined;

  return (
    <div className="app">
      <header className="app-header">
        <Text as="h1" variant="heading">Cribl Blueprint</Text>
        {load.state === 'ready' && load.groups.length > 0 && (
          <div className="header-controls">
            <GroupPicker groups={load.groups} value={groupId} onChange={setGroupId} />
            <Button onClick={reloadInventory} disabled={inv.state === 'loading'}>
              Refresh
            </Button>
          </div>
        )}
      </header>

      <main className="app-body">
        {load.state === 'loading' && <Spinner />}

        {load.state === 'error' && (
          <Alert
            appearance="danger"
            title="Couldn't load Worker Groups and Fleets"
            action={{
              label: 'Retry',
              onClick: () => {
                setLoad({ state: 'loading' });
                setAttempt((n) => n + 1);
              },
            }}
          >
            {load.message}
          </Alert>
        )}

        {load.state === 'ready' && load.groups.length === 0 && (
          <EmptyState
            theme={theme}
            title="No Worker Groups or Fleets"
            description="This workspace has no Stream Worker Groups or Edge Fleets you can read."
          />
        )}

        {group && (
          <>
            {!!group.localChanges && (
              <Alert appearance="warning" title="Uncommitted changes">
                {`${group.id} has ${group.localChanges} uncommitted change${group.localChanges === 1 ? '' : 's'}. Blueprint shows the working config, including uncommitted edits.`}
              </Alert>
            )}

            <TabNav aria-label="Blueprint views" items={tabs} activeKey={tab} onTabPress={(k) => setTab(k as Tab)} />

            {inv.state === 'loading' && <Spinner />}
            {inv.state === 'error' && (
              <Alert
                appearance="danger"
                title={`Couldn't load config for ${inv.group}`}
                action={{ label: 'Retry', onClick: reloadInventory }}
              >
                {inv.message}
              </Alert>
            )}
            {inv.state === 'ready' &&
              inv.warnings.map((w) => (
                <Alert key={w} appearance="warning">
                  {w}
                </Alert>
              ))}
            {inv.state === 'ready' && tab === 'asbuilt' && <AsBuiltTab inventory={inv.inventory} graph={inv.graph} findings={split.active} suppressed={split.suppressed} health={health} throughput={throughput} nodes={{ ...nodes, label: group.kind === 'fleet' ? 'Edge Nodes' : 'Worker Nodes' }} groupKind={group.kind} lineage={lineage} family={family} />}
            {inv.state === 'ready' && tab === 'linter' && (
              <LinterTab
                inventory={inv.inventory}
                graph={inv.graph}
                findings={findings}
                suppressions={suppressions}
                ruleSettings={ruleSettings}
                onConfigChanged={reloadInventory}
              />
            )}
            {inv.state === 'ready' && tab === 'snapshots' && <SnapshotsTab key={inv.group} inventory={inv.inventory} />}
          </>
        )}

        {DevTools && (
          <div className="dev-tools">
            <Button variant="tertiary" onClick={() => setShowDev((s) => !s)}>
              {showDev ? 'Hide dev tools' : 'Show dev tools'}
            </Button>
            {showDev && (
              <Suspense fallback={<Spinner />}>
                <DevTools group={groupId} />
              </Suspense>
            )}
          </div>
        )}
      </main>

      <footer className="app-footer">
        {`Cribl Blueprint v${__APP_VERSION__}${import.meta.env.DEV ? ' · Live Preview' : ''}`}
      </footer>
    </div>
  );
}

export default App;
