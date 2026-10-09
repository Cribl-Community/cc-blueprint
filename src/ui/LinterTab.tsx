import { useState } from 'react';
import { Alert, Button, EmptyState, SelectField, Switch, Tag, Text, TextField } from '@capra/core';
import { planL01Fix, type L01FixPlan } from '../fix/l01';
import type { ReferenceGraph } from '../model/graph';
import type { Inventory } from '../model/types';
import { RULES } from '../lint/rules';
import type { Finding, ObjectRef, Severity } from '../lint/types';
import { disabledRules, effectiveSeverity } from '../store/ruleSettings';
import { applySuppressions } from '../store/suppressions';
import FixL01Modal from './FixL01Modal';
import ObjectDrawer from './ObjectDrawer';
import { useHostTheme } from './theme';
import type { RuleSettingsApi } from './useRuleSettings';
import type { SuppressionsApi } from './useSuppressions';

interface Props {
  inventory: Inventory;
  graph: ReferenceGraph;
  findings: Finding[];
  suppressions: SuppressionsApi;
  ruleSettings: RuleSettingsApi;
  onConfigChanged: () => void;
}

const SEVERITIES: { key: Severity; title: string; color: 'danger' | 'warning' | 'info' }[] = [
  { key: 'error', title: 'Errors', color: 'danger' },
  { key: 'warning', title: 'Warnings', color: 'warning' },
  { key: 'info', title: 'Info', color: 'info' },
];

const RULE_TITLE = new Map(RULES.map((r) => [r.id, r.title]));
const KIND_LABEL = { route: 'Route', pipeline: 'Pipeline', destination: 'Destination', source: 'Source' } as const;
const colorOf = (s: Severity) => SEVERITIES.find((x) => x.key === s)!.color;

interface CardProps {
  f: Finding;
  onOpen: (object: ObjectRef, location?: string) => void;
  onSuppress: (f: Finding, reason: string) => Promise<void>;
  onFix?: () => void;
}

function FindingCard({ f, onOpen, onSuppress, onFix }: CardProps) {
  const [suppressing, setSuppressing] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await onSuppress(f, reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <article className={`finding finding--${f.severity}`}>
      <div className="finding-head">
        <Tag color={colorOf(f.severity)}>{f.ruleId}</Tag>
        <span className="finding-title">{RULE_TITLE.get(f.ruleId)}</span>
        <Button variant="tertiary" size="sm" onClick={() => onOpen(f.object, f.location)}>
          {`${KIND_LABEL[f.object.kind]}: ${f.object.name ?? f.object.id}`}
        </Button>
        <span className="finding-actions">
          {onFix && (
            <Button variant="primary" size="sm" onClick={onFix}>
              Fix it…
            </Button>
          )}
          {!suppressing && (
            <Button size="sm" onClick={() => setSuppressing(true)}>
              Suppress
            </Button>
          )}
        </span>
      </div>
      <Text>{f.message}</Text>
      {(f.location || f.evidence) && (
        <div className="finding-evidence">
          {f.location && <span>{f.location}</span>}
          {f.evidence && <code className="mono">{f.evidence}</code>}
        </div>
      )}
      <Text>
        <strong>Fix: </strong>
        {f.fix}
      </Text>
      {suppressing && (
        <div className="suppress-form">
          <TextField
            label="Reason for suppressing"
            placeholder="e.g. Intentional: unmatched test data is discarded"
            value={reason}
            onChange={setReason}
            maxLength={200}
            autoFocus
          />
          <div className="suppress-actions">
            <Button variant="primary" size="sm" disabled={!reason.trim()} pending={saving} onClick={() => void save()}>
              Suppress finding
            </Button>
            <Button size="sm" disabled={saving} onClick={() => setSuppressing(false)}>
              Cancel
            </Button>
          </div>
          {error && <Alert appearance="danger">{error}</Alert>}
        </div>
      )}
    </article>
  );
}

function RuleSettings({ api }: { api: RuleSettingsApi }) {
  const off = disabledRules(api.doc);
  const changed = Object.keys(api.doc.rules).length;
  return (
    <details className="rule-reference">
      <summary>{`Rules and settings (${RULES.length} rules${off.size ? `, ${off.size} off` : ''}${changed ? `, ${changed} changed for this group` : ''})`}</summary>
      {api.error && <Alert appearance="danger">{api.error}</Alert>}
      <Text>Turn rules off or change their severity for this Worker Group. Settings are shared with everyone who uses Blueprint.</Text>
      <dl>
        {RULES.map((r) => {
          const setting = api.doc.rules[r.id];
          const severity = effectiveSeverity(api.doc, r.id) ?? r.severity;
          const enabled = !off.has(r.id);
          return (
            <div key={r.id} className={`rule-ref${enabled ? '' : ' is-off'}`}>
              <dt>
                <Tag color={colorOf(severity)}>{r.id}</Tag> {r.title}
              </dt>
              <dd>
                <div className="rule-controls">
                  <label className="rule-switch">
                    <Switch
                      aria-label={`${r.id} enabled`}
                      size="sm"
                      checked={enabled}
                      disabled={api.loading}
                      onChange={(e) => void api.update(r.id, { enabled: e.target.checked })}
                    />
                    <span>Enabled</span>
                  </label>
                  <SelectField
                    label="Severity"
                    layout="horizontal"
                    size="sm"
                    items={SEVERITIES.map((s) => ({ id: s.key, label: s.key === r.severity ? `${s.title} (default)` : s.title }))}
                    value={severity}
                    disabled={api.loading || !enabled}
                    onChange={(key) => key !== null && void api.update(r.id, { severity: key as Severity })}
                  />
                  {setting && (
                    <Text variant="body-sm-normal">{`Changed${setting.by ? ` by ${setting.by}` : ''} on ${setting.at.slice(0, 10)}`}</Text>
                  )}
                </div>
                {r.rationale}
              </dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}

export default function LinterTab({ inventory, graph, findings, suppressions, ruleSettings, onConfigChanged }: Props) {
  const [open, setOpen] = useState<{ object: ObjectRef; location?: string } | null>(null);
  const theme = useHostTheme();
  const [fixPlan, setFixPlan] = useState<L01FixPlan | null>(null);
  const [unsuppressError, setUnsuppressError] = useState<string>();
  const off = disabledRules(ruleSettings.doc);
  const { active, suppressed, stale } = applySuppressions(findings, suppressions.doc, off);
  const enabledCount = RULES.length - off.size;
  const rulesPassed = `All ${enabledCount} enabled rule${enabledCount === 1 ? '' : 's'} passed for ${inventory.group}`;
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s.key, active.filter((f) => f.severity === s.key).length]));
  const dynamicRoutes = inventory.routes.filter((r) => !r.disabled && r.outputExpression !== undefined);

  const fixFor = (f: Finding) => {
    if (f.ruleId !== 'L01') return undefined;
    const plan = planL01Fix(inventory.routes, f.object.id);
    return plan ? () => setFixPlan(plan) : undefined;
  };

  const unsuppress = async (key: string) => {
    setUnsuppressError(undefined);
    try {
      await suppressions.unsuppress(key);
    } catch (e) {
      setUnsuppressError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="tab-body">
      <div className="toolbar">
        <div className="stats">
          {SEVERITIES.map((s) => (
            <div key={s.key} className={`stat stat--${s.key}`}>
              <span className="stat-value">{counts[s.key]}</span>
              <span className="stat-label">{s.title}</span>
            </div>
          ))}
          <div className="stat">
            <span className="stat-value">{suppressed.length}</span>
            <span className="stat-label">Suppressed</span>
          </div>
        </div>
      </div>

      {suppressions.error && <Alert appearance="danger">{suppressions.error}</Alert>}

      {graph.hasDynamicOutputs && (
        <Alert appearance="info" title="L04 (orphan destination) skipped">
          {`Route${dynamicRoutes.length === 1 ? '' : 's'} ${dynamicRoutes.map((r) => `"${r.name}"`).join(', ')} choose${dynamicRoutes.length === 1 ? 's' : ''} a destination with an output expression, so any destination could be in use.`}
        </Alert>
      )}

      {active.length === 0 && (
        <EmptyState
          theme={theme}
          illustration="Celebration"
          title="No open findings"
          description={
            suppressed.length
              ? `${rulesPassed}, with ${suppressed.length} finding${suppressed.length === 1 ? '' : 's'} suppressed.`
              : `${rulesPassed}.`
          }
        />
      )}

      {SEVERITIES.filter((s) => counts[s.key] > 0).map((s) => (
        <section key={s.key} className="section">
          <Text as="h2" variant="heading">{`${s.title} (${counts[s.key]})`}</Text>
          {active
            .filter((f) => f.severity === s.key)
            .map((f) => (
              <FindingCard
                key={f.key}
                f={f}
                onOpen={(object, location) => setOpen({ object, location })}
                onSuppress={suppressions.suppress}
                onFix={fixFor(f)}
              />
            ))}
        </section>
      ))}

      {(suppressed.length > 0 || stale.length > 0) && (
        <details className="rule-reference">
          <summary>{`Suppressed (${suppressed.length})${stale.length ? ` · ${stale.length} no longer match` : ''}`}</summary>
          {unsuppressError && <Alert appearance="danger">{unsuppressError}</Alert>}
          <div className="suppressed-list">
            {suppressed.map(({ finding: f, suppression: s }) => (
              <div key={f.key} className="suppressed">
                <div className="finding-head">
                  <Tag color={colorOf(f.severity)}>{f.ruleId}</Tag>
                  <span className="finding-title">{`${KIND_LABEL[f.object.kind]}: ${f.object.name ?? f.object.id}`}</span>
                  <span className="finding-actions">
                    <Button size="sm" onClick={() => void unsuppress(f.key)}>
                      Unsuppress
                    </Button>
                  </span>
                </div>
                <Text>{`“${s.reason}” — ${s.by ?? 'unknown'}, ${new Date(s.at).toLocaleString()}`}</Text>
              </div>
            ))}
            {stale.map(({ key, suppression: s }) => (
              <div key={key} className="suppressed is-stale">
                <div className="finding-head">
                  <Tag>{key.split('/')[0]}</Tag>
                  <span className="finding-title">{`No longer found: ${key.split('/').slice(1).join(' ')}`}</span>
                  <span className="finding-actions">
                    <Button size="sm" onClick={() => void unsuppress(key)}>
                      Remove
                    </Button>
                  </span>
                </div>
                <Text>{`“${s.reason}” — ${s.message}`}</Text>
              </div>
            ))}
          </div>
        </details>
      )}

      <RuleSettings api={ruleSettings} />

      <ObjectDrawer target={open} inventory={inventory} graph={graph} onClose={() => setOpen(null)} />
      <FixL01Modal inventory={inventory} plan={fixPlan} onClose={() => setFixPlan(null)} onApplied={onConfigChanged} />
    </div>
  );
}
