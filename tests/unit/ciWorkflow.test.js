const fs = require('fs');
const yaml = require('js-yaml');

const workflowPath = '.github/workflows/ci.yml';

function workflow() {
    return yaml.load(fs.readFileSync(workflowPath, 'utf8'));
}

function job(name) {
    return workflow().jobs[name];
}

function expectJob(name) {
    const currentJob = job(name);

    expect(currentJob).toBeDefined();

    return currentJob;
}

function usesActions(steps) {
    return steps.map((step) => step.uses).filter(Boolean);
}

function runCommands(steps) {
    return steps.map((step) => step.run).filter(Boolean);
}

function setupNodeStep(steps) {
    return steps.find((step) => step.uses === 'actions/setup-node@v6');
}

function expectSharedNodeSetup(steps, cacheDependencyPath) {
    const setupNode = setupNodeStep(steps);

    expect(usesActions(steps)).toContain('actions/checkout@v6');
    expect(setupNode).toBeDefined();
    expect(String(setupNode.with['node-version'])).toBe('24');
    expect(setupNode.with.cache).toBe('npm');
    expect(setupNode.with['cache-dependency-path']).toBe(cacheDependencyPath);
}

describe('GitHub Actions CI workflow', () => {
    test('has separate extension, web, and cloud jobs', () => {
        const jobs = workflow().jobs;

        expect(jobs.extension).toBeDefined();
        expect(jobs.web).toBeDefined();
        expect(jobs.cloud).toBeDefined();
    });

    test('extension job uses current actions, Node 24, root cache, and root validation commands', () => {
        const steps = expectJob('extension').steps;
        const commands = runCommands(steps);

        expectSharedNodeSetup(steps, 'package-lock.json');
        expect(commands).toContain('npm ci');
        expect(commands).toContain('npm run lint');
        expect(commands).toContain('npm run test:unit');
        expect(commands).toContain('google-chrome --version');
        expect(commands).toContain('npx playwright install --with-deps chromium');
        expect(commands).toContain('npm run test:e2e');
    });

    test('web job uses current actions, Node 24, web cache, and web validation commands', () => {
        const steps = expectJob('web').steps;
        const commands = runCommands(steps);

        expectSharedNodeSetup(steps, 'web/package-lock.json');
        expect(commands).toContain('npm ci --prefix web');
        expect(commands).toContain('npm run lint --prefix web');
        expect(commands).toContain('npm run build --prefix web');
    });

    test('cloud job uses current actions, Node 24, cloud cache, and cloud validation commands', () => {
        const steps = expectJob('cloud').steps;
        const commands = runCommands(steps);

        expectSharedNodeSetup(steps, 'cloud/package-lock.json');
        expect(commands).toContain('npm ci --prefix cloud');
        expect(commands).toContain('npm run typecheck --prefix cloud');
    });
});
