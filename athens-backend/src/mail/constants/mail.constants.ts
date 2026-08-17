export const ALL_MAIL_PATH = '[Gmail]/All Mail';

export const FOLDER_MAILBOX: Record<string, string> = {
  inbox: 'INBOX',
  sent: '[Gmail]/Sent Mail',
  drafts: '[Gmail]/Drafts',
  trash: '[Gmail]/Trash',
  spam: '[Gmail]/Spam',
};

export const SYSTEM_LABELS = new Set([
  'inbox',
  'sent',
  'drafts',
  'trash',
  'spam',
  'starred',
  'important',
  'unread',
  'chat',
  'all mail',
  'all',
  'archive',
]);

export const MAIL_DEFINITION_MAX_CHARS = 2000;
export const MAIL_PAGE_SIZE_MAX = 100;
export const MAIL_AI_LABEL_MAX_MESSAGES = 50;

/** Cap incremental / first-sync envelope fetch so All Mail cannot fill the heap. */
export const IMAP_MAX_NEW_ENVELOPES = 200;

export const BETA_TIER = 'beta';
