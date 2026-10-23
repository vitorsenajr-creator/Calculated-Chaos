// Does an item label still read well? (v3.27.25) Pure: the measures of a label
// laid out by ui/label-render.js in, a verdict out. Settings → Labels uses it
// to warn when ticking a field or shrinking the label leaves a line too small
// or the block taller than the label.

// The smallest sizes worth printing, in inches (the name's own floor in the
// layout is 0.11 in; the warning comes a little before it). Block = share of
// the label's height the layout allows itself (the 0.92 in label-render.js).
export const LABEL_FIT = { minNameIn: 0.13, minCodeIn: 0.2, maxBlockShare: 0.92 };

const pt = (inches) => Math.round(inches * 72);

// m: { codeFontIn, secFontIn, hasSecondary, blockIn, heightIn }.
// Returns { ok, problems: [{ key, text }] }; the keys are stable so the caller
// can tell a new problem from one that was already there.
export function judgeLabelFit(m){
  const problems = [];
  if (m.hasSecondary && m.secFontIn < LABEL_FIT.minNameIn){
    problems.push({ key: 'name-small', text: `The name line shrinks to ${pt(m.secFontIn)} pt, which is hard to read on paper.` });
  }
  if (m.codeFontIn < LABEL_FIT.minCodeIn){
    problems.push({ key: 'code-small', text: `The product code shrinks to ${pt(m.codeFontIn)} pt.` });
  }
  if (m.blockIn > m.heightIn * LABEL_FIT.maxBlockShare + 1e-9){
    const tall = `The lines together are ${m.blockIn.toFixed(2)} in tall on a ${m.heightIn} in label`;
    problems.push({ key: 'too-tall', text: m.blockIn > m.heightIn ? `${tall}, so the bottom would be cut off.` : `${tall}, which leaves almost no margin.` });
  }
  return { ok: problems.length === 0, problems };
}
