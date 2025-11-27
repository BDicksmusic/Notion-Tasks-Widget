/**
 * Master Test Runner: Run All Backend Tests
 * 
 * This script runs all individual test scripts and provides a summary.
 * 
 * Run: npx ts-node scripts/test-all.ts
 */

import { spawn } from 'child_process';
import * as path from 'path';

interface TestSuite {
  name: string;
  script: string;
  passed?: boolean;
  error?: string;
}

const testSuites: TestSuite[] = [
  { name: 'Tasks', script: 'test-notionTasks.ts' },
  { name: 'Projects', script: 'test-notionProjects.ts' },
  { name: 'Time Logs', script: 'test-notionTimeLogs.ts' },
  { name: 'Writing', script: 'test-notionWriting.ts' },
  { name: 'Contacts', script: 'test-notionContacts.ts' },
  { name: 'Full Flow', script: 'test-full-flow.ts' },
];

function runTest(suite: TestSuite): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`\n${'▓'.repeat(70)}`);
    console.log(`▓  Running: ${suite.name}`);
    console.log(`${'▓'.repeat(70)}\n`);

    const scriptPath = path.join(__dirname, suite.script);
    const child = spawn('npx', ['ts-node', scriptPath], {
      stdio: 'inherit',
      shell: true
    });

    child.on('close', (code) => {
      suite.passed = code === 0;
      if (code !== 0) {
        suite.error = `Exit code: ${code}`;
      }
      resolve(code === 0);
    });

    child.on('error', (err) => {
      suite.passed = false;
      suite.error = err.message;
      resolve(false);
    });
  });
}

async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              NOTION TASKS WIDGET - FULL TEST SUITE                   ║');
  console.log('║                  Running All Backend Tests                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const startTime = Date.now();

  // Run each test suite sequentially
  for (const suite of testSuites) {
    await runTest(suite);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                        FINAL SUMMARY                                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const passed = testSuites.filter(s => s.passed).length;
  const failed = testSuites.filter(s => !s.passed).length;

  console.log(`\n  ⏱️  Total time: ${duration}s`);
  console.log(`  📊 Results: ${passed} passed, ${failed} failed\n`);

  testSuites.forEach(suite => {
    const icon = suite.passed ? '✅' : '❌';
    console.log(`  ${icon} ${suite.name}${suite.error ? ` - ${suite.error}` : ''}`);
  });

  console.log('\n' + '═'.repeat(72));

  if (failed > 0) {
    console.log('  ⚠️  SOME TEST SUITES FAILED');
    process.exit(1);
  } else {
    console.log('  🎉 ALL TEST SUITES PASSED!');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

