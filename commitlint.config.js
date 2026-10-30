/**
 * Conventional Commits (https://www.conventionalcommits.org/) : requis par release-please
 * pour calculer la version et générer le changelog.
 *   feat: …   → version mineure      fix: … / perf: … → correctif
 *   feat!: … ou « BREAKING CHANGE: » dans le corps → version majeure
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
    'body-max-line-length': [0],
  },
};
