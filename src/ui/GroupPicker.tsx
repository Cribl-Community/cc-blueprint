import { SelectField } from '@capra/core';
import type { WorkerGroup } from '../api/groups';

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
  const sections = SECTIONS.map((s) => ({ ...s, groups: groups.filter((g) => g.kind === s.kind) })).filter((s) => s.groups.length);
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
          {s.groups.map((g) => (
            <SelectField.Item key={g.id} id={g.id} textValue={label(g)}>
              {label(g)}
            </SelectField.Item>
          ))}
        </SelectField.Section>
      ))}
    </SelectField>
  );
}
