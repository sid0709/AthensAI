import dns from 'node:dns';
import nodemailer from 'nodemailer';

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 465;

/**
 * Prefer IPv4 for Gmail SMTP. On some networks Node resolves smtp.gmail.com to
 * IPv6 first and then fails with ENETUNREACH after a long hang.
 */
function ipv4Lookup(hostname, options, callback) {
	const opts =
		typeof options === 'object' && options
			? { ...options, family: 4, all: false }
			: { family: 4 };
	dns.lookup(hostname, opts, callback);
}

function createTransport(email, password) {
	return nodemailer.createTransport({
		host: SMTP_HOST,
		port: SMTP_PORT,
		secure: true,
		auth: {
			user: email,
			pass: password,
		},
		connectionTimeout: 20_000,
		greetingTimeout: 15_000,
		socketTimeout: 30_000,
		lookup: ipv4Lookup,
	});
}

function friendlySmtpError(err) {
	const code = err?.code || '';
	const message = err instanceof Error ? err.message : String(err);
	if (code === 'ENETUNREACH' || /ENETUNREACH/i.test(message)) {
		return 'Could not reach Gmail SMTP (network unreachable). Check your network or try again — IPv4 is preferred automatically.';
	}
	if (code === 'ETIMEDOUT' || code === 'ESOCKET' || /timeout/i.test(message)) {
		return 'Gmail SMTP timed out. Check your network connection and Gmail app password, then try again.';
	}
	if (code === 'EAUTH' || /Invalid login|Username and Password not accepted/i.test(message)) {
		return 'Gmail rejected the login. Verify the address and app password in Settings → Profile.';
	}
	return message || 'Failed to send mail';
}

export async function sendMail({ email, password, to, subject, body, inReplyTo, references }) {
	const transport = createTransport(email, password);
	try {
		const mailOptions = {
			from: email,
			to,
			subject,
			text: body,
			html: body.includes('<') ? body : undefined,
		};
		if (inReplyTo) mailOptions.inReplyTo = inReplyTo;
		if (references) mailOptions.references = references;

		const info = await transport.sendMail(mailOptions);
		return {
			messageId: info.messageId,
			accepted: info.accepted,
		};
	} catch (err) {
		const wrapped = new Error(friendlySmtpError(err));
		wrapped.cause = err;
		wrapped.code = err?.code;
		throw wrapped;
	} finally {
		transport.close();
	}
}
