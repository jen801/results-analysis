'use strict';

const fetch = require ('node-fetch');
const flags = require('flags');
const fs = require('fs');

const metrics = require('./metrics.js');

flags.defineMultiString('report-file', [], 'path to report.json file');
flags.defineMultiString('report-url', [], 'URL to report.json file');
flags.defineString('runs-query', 'label=stable', 'wpt.fyi/api/runs query string (used if --report-*= is not used)');
flags.defineString('test-prefix', '', 'Test path prefix to filter tests by');
flags.defineBoolean('normalize-per-test', true, 'Normalize score of each test to [0, 1] instead of counting subtests');
flags.defineBoolean('require-harness-ok', true, 'Require harness status to be OK to count tests');
flags.defineBoolean('interop', false, 'Compute interop numbers');
flags.parse();

async function main() {
  const options = {
    normalizePerTest: flags.get('normalize-per-test'),
    requireHarnessOK: flags.get('require-harness-ok'),
  }

  const reports = [];

  console.info('Reading reports...');
  for (const file of flags.get('report-file')) {
    reports.push(JSON.parse(fs.readFileSync(file, 'UTF-8')));
  }

  for (const url of flags.get('report-url')) {
    reports.push(await (await fetch(url)).json());
  }

  if (reports.length === 0) {
    const query = flags.get('runs-query');
    const url = `https://wpt.fyi/api/runs?${query}`
    const runs = await (await fetch(url)).json();
    for (const run of runs) {
      const url = run.raw_results_url;
      console.info(`Fetching ${url}`);
      reports.push(await (await fetch(url)).json());
    }
  }

  if (reports.length === 0) {
    console.error(`No reports to score, see --help for usage.`);
    process.exit(1);
  }

  // sort reports to make output nicer, doesn't affect scoring
  for (const report of reports) {
    report.results.sort((a, b) => {
      return a.test.localeCompare(b.test);
    });
  }

  let testPrefix = flags.get('test-prefix');
  if (testPrefix) {
    if (!testPrefix.startsWith('/')) {
      testPrefix = `/${testPrefix}`;
    }
    options.testFilter = test => test.test.startsWith(testPrefix);
  }

  console.info('Computing scores...');
  const computeInterop = flags.get('interop');
  if (!computeInterop) {
    // score each report individually (the default)
    for (const report of reports) {
      let [score, total] = metrics.scoreReport(report, options);
      const pct = (100 * score / total).toFixed(2);
      if (options.normalizePerTest) {
        score = score.toFixed(2);
      }
      console.log(`${report.browser_name}: ${score} / ${total} => ${pct}%`);
    }
  } else {
    // compute interop score
    const scores = metrics.scoreInterop(reports, options);
    const total = scores[reports.length + 1];
    for (let i = 0; i <= reports.length; i++) {
      let score = scores[i];
      const pct = (100 * score / total).toFixed(2);
      if (options.normalizePerTest) {
        score = score.toFixed(2);
      }
      console.log(`${i}/${reports.length}: ${score} / ${total} => ${pct}%`);
    }
  }
}

main();