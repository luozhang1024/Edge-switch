const AGREEMENT = 'I have read and agree to the Edge Switch CLA v1.0.';
const LICENSOR = 'luozhang1024';

function evaluate(pr, comments, commits) {
  const required = new Set([pr.user.login]);
  for (const commit of commits) {
    if (!commit.author?.login) {
      return { state: 'pending', description: 'Commit author must be linked to GitHub; see CONTRIBUTING.md' };
    }
    required.add(commit.author.login);
    const coauthors = commit.commit.message.matchAll(/^Co-authored-by:\s*(.+)$/gim);
    for (const [, author] of coauthors) {
      const match = author.match(/<(?:(?:\d+)\+)?([a-zA-Z0-9-]+)@users\.noreply\.github\.com>\s*$/i);
      if (!match) {
        return { state: 'pending', description: 'Coauthor authorization needs review; see CONTRIBUTING.md' };
      }
      required.add(match[1]);
    }
  }
  const signed = new Set(comments
    .filter(c => c.user?.type === 'User' && c.body?.trim() === AGREEMENT)
    .map(c => c.user.login.toLowerCase()));
  const missing = [...required].filter(login => login.toLowerCase() !== LICENSOR && !signed.has(login.toLowerCase()));
  return missing.length
    ? { state: 'pending', description: 'All contributors must comment agreement to CLA v1.0; see CLA.md' }
    : { state: 'success', description: 'CLA v1.0 agreement recorded; maintainer rights review still required' };
}

async function check({ github, context, core }) {
  const repo = context.repo;
  let numbers = [context.payload.pull_request?.number || context.payload.issue?.number].filter(Boolean);
  if (context.eventName === 'workflow_dispatch') {
    numbers = (await github.paginate(github.rest.pulls.list, { ...repo, state: 'open', per_page: 100 })).map(pr => pr.number);
  }
  for (const number of numbers) {
    const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: number });
    if (pr.state !== 'open') continue;
    // Set pending first so an API failure cannot leave a stale success status.
    const status = { ...repo, sha: pr.head.sha, context: 'cla/contributor-license', target_url: `${context.payload.repository.html_url}/blob/${context.payload.repository.default_branch}/CLA.md` };
    await github.rest.repos.createCommitStatus({ ...status, state: 'pending', description: 'Checking contributor license agreements' });
    const [comments, commits] = await Promise.all([
      github.paginate(github.rest.issues.listComments, { ...repo, issue_number: number, per_page: 100 }),
      github.paginate(github.rest.pulls.listCommits, { ...repo, pull_number: number, per_page: 100 }),
    ]);
    // GitHub caps this endpoint at 250 commits. Fail closed rather than omit authors.
    const result = pr.commits > 250
      ? { state: 'pending', description: 'Split PRs over 250 commits so all authors can be checked' }
      : evaluate(pr, comments, commits);
    await github.rest.repos.createCommitStatus({ ...status, ...result });
    core.info(`PR #${number}: ${result.state}. ${result.description}`);
    for (const comment of comments.filter(c => c.body?.trim() === AGREEMENT)) {
      core.info(`CLA v1.0 record: ${comment.user.login}, ${comment.html_url}, ${comment.created_at}, head ${pr.head.sha}`);
    }
  }
}

module.exports = { AGREEMENT, evaluate, check };
