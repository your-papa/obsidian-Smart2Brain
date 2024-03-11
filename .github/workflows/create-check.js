const { Octokit } = require("@octokit/rest");
const { execSync } = require("child_process");
const github = require("@actions/github");

async function createCheck() {
    const token = process.env.GITHUB_TOKEN;
    const octokit = new Octokit({ auth: token });
    const context = github.context;

    // Run grep to find console.log statements
    let output;
    try {
        output = execSync("grep -rnw 'src/' -e 'console.log'").toString().trim();
    } catch (error) {
        output = ''; // No console.log statements found
    }

    const logLines = output.split('\n').filter(line => line.length);
    const annotations = logLines.map(line => {
        const [file, lineNo] = line.split(':');
        return {
            path: file.replace('src/', ''), // Adjust according to your repo structure
            start_line: parseInt(lineNo),
            end_line: parseInt(lineNo),
            annotation_level: 'warning',
            message: 'console.log statement found',
            start_column: 1,
            end_column: 1
        };
    });

    await octokit.rest.checks.create({
        owner: context.repo.owner,
        repo: context.repo.repo,
        name: 'Console Log Check',
        head_sha: context.sha,
        status: 'completed',
        conclusion: logLines.length > 0 ? 'failure' : 'success',
        output: {
            title: 'Console Log Check',
            summary: logLines.length > 0 ? 'Found console.log statements in the following locations:' : 'No console.log statements found.',
            annotations: annotations
        }
    });
}

createCheck().catch(err => {
    console.error(err);
    process.exit(1);
});
