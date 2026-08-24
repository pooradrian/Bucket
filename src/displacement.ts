export type DisplacementRule =
  | {kind: 'remove'; word: string}
  | {kind: 'replace'; word: string; replacements: string[]}
  | {kind: 'swap'; a: string; b: string};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseDisplacements(raw: string): DisplacementRule[] {
  const rules: DisplacementRule[] = [];
  for (const line of raw.split('\n')) {
    const noComment = line.split('//')[0].trim();
    if (!noComment) continue;

    if (noComment.includes('<=>')) {
      const [a, ...rest] = noComment.split('<=>');
      const b = rest.join('<=>').trim();
      const lhs = a.trim();
      if (lhs && b) rules.push({kind: 'swap', a: lhs, b});
      continue;
    }

    if (noComment.includes('=>')) {
      const [a, ...rest] = noComment.split('=>');
      const word = a.trim();
      if (!word) continue;
      const rhs = rest.join('=>').trim();
      const replacements = rhs === '' ? [' '] : rhs.split('~').map(s => s.trim());
      rules.push({kind: 'replace', word, replacements});
      continue;
    }

    rules.push({kind: 'remove', word: noComment});
  }
  return rules;
}

// Deterministic pick so re-applying rules to a growing stream doesn't reroll
// choices mid-generation. Same seed => same choices for the whole reply.
function stablePick(seed: number, ruleIdx: number, occIdx: number, count: number): number {
  const x = Math.sin(seed * 12.9898 + ruleIdx * 78.233 + occIdx * 37.719) * 43758.5453;
  return Math.abs(Math.floor(x)) % count;
}

export function applyDisplacements(text: string, rules: DisplacementRule[], seed: number = 0): string {
  let result = text;
  rules.forEach((rule, ruleIdx) => {
    if (rule.kind === 'swap') {
      const re = new RegExp(`\\b(?:${escapeRegExp(rule.a)}|${escapeRegExp(rule.b)})\\b`, 'gi');
      result = result.replace(re, match =>
        match.toLowerCase() === rule.a.toLowerCase() ? rule.b : rule.a,
      );
    } else if (rule.kind === 'replace') {
      const re = new RegExp(`\\b${escapeRegExp(rule.word)}\\b`, 'gi');
      let occ = 0;
      result = result.replace(re, () =>
        rule.replacements.length === 1
          ? rule.replacements[0]
          : rule.replacements[stablePick(seed, ruleIdx, occ++, rule.replacements.length)],
      );
    } else {
      const re = new RegExp(`\\b${escapeRegExp(rule.word)}\\b`, 'gi');
      result = result.replace(re, '');
    }
  });
  return result;
}
