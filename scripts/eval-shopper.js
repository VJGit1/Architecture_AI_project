#!/usr/bin/env node
// Runs the shopper brief suite against the local compiler and an in-memory graph.
// Usage: npm run eval            (table)
//        npm run eval -- --json  (full report)

process.env.ROOM_FIT_OFFLINE = '1';
// Keys are blanked so runs are deterministic; dotenv does not override variables that already exist.
process.env.OPENAI_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';

const { ShopperBriefSuite } = require('../src/agent/evaluator');

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const mark = c => (c === null || c === undefined ? '  - ' : c.pass ? 'pass' : 'FAIL');

(async () => {
  const report = await new ShopperBriefSuite().run();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Room fit shopper eval (local compiler, in-memory graph)\n');
    console.log(`${pad('brief', 28)} ${pad('budget', 6)} ${pad('roles', 6)} ${pad('doors', 6)} ${pad('facing', 6)} ${pad('repairs', 7)} ${pad('checks', 7)} result`);
    for (const r of report.results) {
      const c = r.categories;
      console.log(`${pad(r.id, 28)} ${pad(mark(c.budget), 6)} ${pad(mark(c.roles), 6)} ${pad(mark(c.doors), 6)} ${pad(mark(c.facing), 6)} ${pad(r.repairs, 7)} ${pad(`${r.passedChecks}/${r.totalChecks}`, 7)} ${r.passed ? 'pass' : 'FAIL'}`);
      r.checks.filter(x => !x.pass).forEach(x => console.log(`    failed: ${x.name}${x.detail ? ` (${x.detail})` : ''}`));
      Object.values(c).filter(x => x && !x.pass).forEach(x => console.log(`    failed: ${x.name} (${x.detail})`));
    }

    const s = report.summary;
    const cat = name => `${s.categories[name].passed}/${s.categories[name].total}`;
    console.log('');
    console.log(`Briefs:  ${s.briefsPassed} passed, ${s.briefsFailed} failed of ${s.briefs}`);
    console.log(`Checks:  ${s.checksPassed}/${s.checksTotal}`);
    console.log(`Budget ${cat('budget')}  Roles ${cat('roles')}  Doors ${cat('doors')}  Facing ${cat('facing')}`);
    console.log(`Pass@1 (first critique, no repair): ${s.passAt1} (${s.passAt1Rate})`);
    console.log(`Pass after repair:                  ${s.passAfterRepair} (${s.passAfterRepairRate})`);
    console.log(`Open issues: ${s.openIssues}   Time: ${s.durationMs} ms`);
  }

  process.exit(report.summary.briefsFailed === 0 ? 0 : 1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
