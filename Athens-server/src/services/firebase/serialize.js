/**
 * Convert Firestore values into JSON-safe shapes for the explorer UI.
 */
export function serializeFirestoreValue(value) {
	if (value === null || value === undefined) return value;

	if (typeof value?.toDate === "function") {
		try {
			return { __type: "Timestamp", value: value.toDate().toISOString() };
		} catch {
			return { __type: "Timestamp", value: String(value) };
		}
	}

	if (typeof value?.latitude === "number" && typeof value?.longitude === "number" && value.constructor?.name === "GeoPoint") {
		return { __type: "GeoPoint", latitude: value.latitude, longitude: value.longitude };
	}

	if (typeof value?.path === "string" && typeof value?.id === "string" && typeof value?.get === "function") {
		return { __type: "DocumentReference", path: value.path };
	}

	if (Buffer.isBuffer(value)) {
		return { __type: "Bytes", byteLength: value.byteLength, preview: value.toString("base64").slice(0, 64) };
	}

	if (Array.isArray(value)) {
		return value.map(serializeFirestoreValue);
	}

	if (value instanceof Map) {
		const out = {};
		for (const [k, v] of value.entries()) out[String(k)] = serializeFirestoreValue(v);
		return out;
	}

	if (typeof value === "object") {
		const out = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = serializeFirestoreValue(v);
		}
		return out;
	}

	return value;
}

export function serializeDocument(doc) {
	const data = doc.data();
	return {
		id: doc.id,
		path: doc.ref.path,
		createTime: doc.createTime?.toDate?.()?.toISOString?.() || null,
		updateTime: doc.updateTime?.toDate?.()?.toISOString?.() || null,
		data: serializeFirestoreValue(data),
		fieldCount: data && typeof data === "object" ? Object.keys(data).length : 0,
	};
}

/** Split a Firestore path into collection/document segments. */
export function parseFirestorePath(rawPath) {
	const path = String(rawPath || "")
		.trim()
		.replace(/^\/+|\/+$/g, "");
	if (!path) return { path: "", segments: [], isCollection: false, isDocument: false };
	const segments = path.split("/").filter(Boolean);
	return {
		path: segments.join("/"),
		segments,
		isCollection: segments.length % 2 === 1,
		isDocument: segments.length % 2 === 0,
	};
}
