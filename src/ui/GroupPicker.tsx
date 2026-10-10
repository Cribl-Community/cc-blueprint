import { SelectField } from '@capra/core';
import { fleetTree, type WorkerGroup } from '../api/groups';

interface Props {
  groups: WorkerGroup[];
  value: string | null;
  onChange: (groupId: string) => void;
}

const SECTIONS: { kind: WorkerGroup['kind']; title: string }[] = [
  { kind: 'stream', title: 'Worker Groups' },
  { kind: 'fleet', title: 'Edge Fleets' },
];

const label = (g: WorkerGroup) => (g.name === g.id ? g.id : `${g.name} (${g.id})`);

/** Worker Groups and Edge Fleets under their own headings, so each option is just its name. */
export default function GroupPicker({ groups, value, onChange }: Props) {
  const sections = SECTIONS.map((s) => {
    const own = groups.filter((g) => g.kind === s.kind);
    // Subfleets follow their parent, marked ↳ per level.
    const rows = s.kind === 'fleet' ? fleetTree(own) : own.map((group) => ({ group, depth: 0 }));
    return { ...s, rows };
  }).filter((s) => s.rows.length);
  return (
    <SelectField
      label="Group"
      layout="horizontal"
      placeholder="Select a Worker Group or Fleet"
      value={value}
      onChange={(key) => key !== null && onChange(String(key))}
      canSearch={groups.length > 8}
      FORCE__className="group-picker"
    >
      {sections.map((s) => (
        <SelectField.Section key={s.kind}>
          <SelectField.Header label={s.title} />
          {s.rows.map(({ group: g, depth }) => (
            <SelectField.Item key={g.id} id={g.id} textValue={label(g)}>
              {`${'\u00a0\u00a0'.repeat(Math.max(0, depth - 1))}${depth ? '↳ ' : ''}${label(g)}`}
            </SelectField.Item>
          ))}
        </SelectField.Section>
      ))}
    </SelectField>
  );
}
