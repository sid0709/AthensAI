export function includesFirebaseAuth(raw = process.env.MIGRATION_INCLUDE_AUTH) {
	return /^(1|true|yes)$/i.test(String(raw || "false"));
}

export function applyLegacyCredentialPolicy(account, includeAuth = includesFirebaseAuth()) {
	if (includeAuth) {
		delete account.password;
		delete account.vendorPassword;
	}
	return account;
}
