function cleanName(value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	const parts = raw.replace(/\\/g, "/").split("/");
	return parts[parts.length - 1] || "";
}

/**
 * Preserve the first real local filename when an ATS copies an already-renamed
 * File into a second upload control during the same recording session.
 */
export function resolveResumeOriginalName({
	existingOriginalName,
	existingExpectedName,
	existingCleanedName,
	existingSessionId,
	incomingOriginalName,
	incomingExpectedName,
	incomingCleanedName,
	incomingSessionId,
}) {
	const existingOriginal = cleanName(existingOriginalName);
	const incomingOriginal = cleanName(incomingOriginalName);
	if (!existingOriginal || !incomingOriginal) return incomingOriginal || existingOriginal;

	const existingSession = String(existingSessionId || "").trim();
	const incomingSession = String(incomingSessionId || "").trim();
	const isSameSession =
		Boolean(existingSession && incomingSession) && existingSession === incomingSession;
	const shouldProtectExisting = isSameSession || !incomingSession;
	if (!shouldProtectExisting) return incomingOriginal;

	const transformedNames = new Set(
		[
			existingExpectedName,
			existingCleanedName,
			incomingExpectedName,
			incomingCleanedName,
		]
			.map(cleanName)
			.filter(Boolean),
	);
	const incomingLooksTransformed = transformedNames.has(incomingOriginal);
	const existingLooksTransformed = transformedNames.has(existingOriginal);
	return incomingLooksTransformed && !existingLooksTransformed
		? existingOriginal
		: incomingOriginal;
}
