/**
 * Record a CLA commitment made in an issue to the appropriate JSON file.
 *
 * Given the URL of a GitHub issue that record a CLA commitment from a
 * contributor, the script:
 * 1. locks the issue to prevent any further update
 * 2. amends the relevant JSON file (`owner/repo.json`)
 * 3. closes the issue if the CLA commitment already existed
 *
 * Note: When the relevant JSON file is updated, the script does not commit the
 * change and does not close the issue either. That's supposed to be done by
 * the workflow that triggers the script, so that both happen at once.
 */
import dotenv from 'dotenv';
import { Octokit } from 'octokit';
import fs from 'node:fs';

const reIssueUrl = /^https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/;
const rePRUrl = /^https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/;

// Expected issue section titles
// Note: this needs to be updated if the underlying issue template in
// .github/ISSUE_TEMPLATE/cla-commitment.yml changes
const sectionTitle = {
  repository: 'Project repository',
  pr: 'Pull request'
};


/********** STEP: start **********/
console.log('Check parameters...');
if (process.argv.length < 2) {
  console.error('- no issue URL received as parameter');
  process.exit(1);
}
const issueUrl = process.argv[2];
const issueMatch = issueUrl.match(reIssueUrl);
if (!issueMatch) {
  console.error(`- unexpected issue URL: ${issueUrl}`);
  process.exit(1);
}
const [, owner, repo, issue_number] = issueMatch;
console.log(`- issue: ${issueMatch}`);

// Make sure we have a GITHUB_TOKEN for authentication
dotenv.config({ quiet: true });
if (!process.env.GITHUB_TOKEN) {
  console.error('- no GITHUB_TOKEN variable found');
  process.exit(1);
}
console.log('Check parameters... done');
/********** STEP: end   **********/


/********** STEP: start **********/
console.log(`Fetch issue from GitHub...`);
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
  //, log: console
});
const issueResponse = await octokit.rest.issues.get({
  owner, repo, issue_number
});
const issue = issueResponse.data;

const issueSections = splitIntoSections(issue.body);
let repository = null;
let pr = null;
for (const section of issueSections) {
  if (section.title === sectionTitle.repository) {
    repository = section.value;
    if (!repository?.match(/\//)) {
      console.error(`- project repository does not look like one: ${repository}`);
      process.exit(1);
    }
    console.log(`- repository: ${repository}`);
  }
  else if (section.title === sectionTitle.pr) {
    if (section.value) {
      pr = section.value;
      if (!pr.match(rePRUrl)) {
        console.error(`- pull request does not look valid: ${pr}`);
        process.exit(1);
      }
      console.log(`- originating PR: ${pr}`);
    }
  }
}
if (!repository) {
  console.error('- no project repository section found in the issue');
  process.exit(1);
}
// TODO: validate checkboxes
console.log(`Fetch issue from GitHub... done`);
/********** STEP: end   **********/


/********** STEP: start **********/
console.log('Lock issue to prevent any further update...');
await octokit.rest.issues.lock({ owner, repo, issue_number });
console.log('Lock issue to prevent any further update... done');
/********** STEP: end   **********/


/********** STEP: start **********/
console.log('Record CLA commitment...');
const commitment = {
  id: issue.user.id,
  username: issue.user.login,
  date: (new Date()).toISOString(),
  issue: issueUrl
};
if (pr) {
  commitment.pr = pr;
}

const commitmentsFile = repository + '.json';
let commitments = [];
try {
  const commitmentsStr = fs.readFileSync(commitmentsFile, 'utf8');
  commitments = JSON.parse(commitmentsStr);
}
catch (err) {
  // No problem if the file does not exist, we'll just create it
  if (err.code !== 'ENOENT') {
    throw err;
  }
}

if (commitments.find(c => c.id === commitment.id)) {
  console.log(`- commitment already found in ${commitmentsFile}`);
  if (issue.state === 'open') {
    await octokit.rest.issues.addLabels({ owner, repo, issue_number, labels: ['duplicate'] });
    await octokit.rest.issues.update({ owner, repo, issue_number, state: 'closed' });
  }
}
else {
  console.log(`- add commitment to ${commitmentsFile}`);
  commitments.push(commitment);
  fs.writeFileSync(commitmentsFile, JSON.stringify(commitments, null, 2), 'utf8');
}
console.log('Record CLA commitment... done');
/********** STEP: end   **********/


/**
 * Helper function to split a session issue body (in markdown) into sections
 */
function splitIntoSections(body) {
  return body.trim().split(/^### /m)
    .filter(section => !!section)
    .map(section => section.split(/\r?\n/))
    .map(section => {
      let value = section.slice(1).join('\n').trim();
      if (value.replace(/^_(.*)_$/, '$1') === 'No response') {
        value = null;
      }
      return {
        title: section[0],
        value
      };
    });
}
