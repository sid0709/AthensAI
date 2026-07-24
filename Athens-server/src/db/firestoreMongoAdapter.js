import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { getFirestoreDb } from "../services/firebase/firebaseAdmin.js";
import { assertFirestoreDocumentSize } from "../services/firebase/objectStore.js";

const UNIQUE_KEYS = {
	account_info: ["name"], personal_info: ["name"], vendor_tasks: [["applierName", "jobId"], ["applierName", "applyUrl"]],
	mail_messages: ["applierName", "mailbox", "uid"], mail_sync_state: ["applierName"], mail_user_labels: ["applierName"],
	resume_generator_config: ["applierName"], rules: ["name"],
	job_match_scores: ["applierName", "jobId"], match_profile_state: ["applierName"],
	external_scraped_jobs: [["jobID"], ["jobLink"]],
	user_skills: ["applierName", "nameCanonical"], skill_dictionary: ["nameCanonical"],
	skill_enrichment_queue: ["normalizedKey"], skill_cooccurrence: ["pairKey"],
	user_knowledge_graphs: ["applierName", "resumeId"], avalon_apply_runs: ["runId"],
	monitor_current_status: ["component"], monitor_daily_rollups: ["date", "component"],
};

const warnedScans = new Set();
const FIRESTORE_OPERATORS = new Map([
	["$eq", "=="],
	["$gt", ">"],
	["$gte", ">="],
	["$lt", "<"],
	["$lte", "<="],
	["$in", "in"],
]);

// Some Mongo partial unique indexes have alternative business keys. The first
// complete key set is also used for deterministic IDs on newly inserted rows;
// every complete key set gets a reservation document.

function isPlain(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof ObjectId);
}

function buildNativeQueryPlan(filter = {}) {
	const clauses = [];
	let complete = true;
	function visit(node) {
		if (!isPlain(node)) { complete = false; return; }
		for (const [field, condition] of Object.entries(node)) {
			if (field === "$and" && Array.isArray(condition)) {
				condition.forEach(visit);
				continue;
			}
			if (field.startsWith("$") || field === "_id" || condition instanceof RegExp) {
				complete = false;
				continue;
			}
			if (!isPlain(condition) || condition instanceof Date || condition instanceof ObjectId) {
				clauses.push({ field, operator: "==", value: encode(condition) });
				continue;
			}
			const entries = Object.entries(condition);
			if (!entries.length || entries.some(([operator, operand]) => !FIRESTORE_OPERATORS.has(operator) || operand instanceof RegExp)) {
				complete = false;
				continue;
			}
			for (const [operator, operand] of entries) {
				if (operator === "$in" && (!Array.isArray(operand) || operand.length === 0 || operand.length > 30 || operand.some((item) => item instanceof RegExp))) {
					complete = false;
					continue;
				}
				clauses.push({ field, operator: FIRESTORE_OPERATORS.get(operator), value: encode(operand) });
			}
		}
	}
	visit(filter);
	return { clauses, complete };
}

function conjunctiveDocumentIds(filter = {}) {
	if (!isPlain(filter)) return null;
	if (isPlain(filter._id) && Array.isArray(filter._id.$in)) return filter._id.$in.map((id) => String(comparable(id)));
	if (Array.isArray(filter.$and)) {
		for (const child of filter.$and) {
			const ids = conjunctiveDocumentIds(child);
			if (ids) return ids;
		}
	}
	return null;
}

function encode(value) {
	if (value instanceof ObjectId) return value.toHexString();
	if (value instanceof Date) return value;
	if (value instanceof RegExp) return value;
	if (Array.isArray(value)) return value.map(encode);
	if (isPlain(value)) {
		const out = {};
		for (const [key, child] of Object.entries(value)) if (child !== undefined) out[key] = encode(child);
		return out;
	}
	return value;
}

function decodeDoc(id, data) {
	const decoded = { ...data };
	decoded._id = /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : id;
	return decoded;
}

function comparable(value) {
	if (value instanceof ObjectId) return value.toHexString();
	if (value instanceof Date) return value.getTime();
	if (value?.toDate instanceof Function) return value.toDate().getTime();
	return value;
}

function equal(a, b) {
	a = comparable(a); b = comparable(b);
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
	if (isPlain(a) && isPlain(b)) {
		const ak = Object.keys(a), bk = Object.keys(b);
		return ak.length === bk.length && ak.every((key) => equal(a[key], b[key]));
	}
	return a === b;
}

function valuesAt(value, path) {
	const parts = Array.isArray(path) ? path : String(path).split(".");
	if (!parts.length) return [value];
	if (Array.isArray(value)) return value.flatMap((item) => valuesAt(item, parts));
	if (value == null || typeof value !== "object") return [undefined];
	return valuesAt(value[parts[0]], parts.slice(1));
}

function getPath(value, path) {
	const values = valuesAt(value, path);
	return values.length === 1 ? values[0] : values;
}

function setPath(target, path, value) {
	const parts = String(path).split(".");
	let node = target;
	for (let i = 0; i < parts.length - 1; i += 1) {
		if (!isPlain(node[parts[i]])) node[parts[i]] = {};
		node = node[parts[i]];
	}
	node[parts.at(-1)] = value;
}

function unsetPath(target, path) {
	const parts = String(path).split(".");
	let node = target;
	for (let i = 0; i < parts.length - 1; i += 1) {
		node = node?.[parts[i]];
		if (!node) return;
	}
	delete node[parts.at(-1)];
}

function regex(value, pattern, options = "") {
	const re = pattern instanceof RegExp ? pattern : new RegExp(String(pattern), options);
	return re.test(String(value ?? ""));
}

function matchesCondition(values, condition, vars) {
	const list = Array.isArray(values) ? values : [values];
	if (condition instanceof RegExp) return list.some((value) => regex(value, condition));
	if (!isPlain(condition) || !Object.keys(condition).some((key) => key.startsWith("$"))) {
		return list.some((value) => equal(value, encode(condition)) || (Array.isArray(value) && value.some((item) => equal(item, encode(condition)))));
	}
	for (const [operator, operand] of Object.entries(condition)) {
		if (operator === "$options") continue;
		if (operator === "$exists" && (operand ? list.every((v) => v === undefined) : list.some((v) => v !== undefined))) return false;
		if (operator === "$eq" && !list.some((v) => equal(v, encode(operand)))) return false;
		if (operator === "$ne" && list.some((v) => equal(v, encode(operand)))) return false;
		if (operator === "$gt" && !list.some((v) => comparable(v) > comparable(operand))) return false;
		if (operator === "$gte" && !list.some((v) => comparable(v) >= comparable(operand))) return false;
		if (operator === "$lt" && !list.some((v) => comparable(v) < comparable(operand))) return false;
		if (operator === "$lte" && !list.some((v) => comparable(v) <= comparable(operand))) return false;
		if (operator === "$in" && !list.some((v) => operand.some((item) => item instanceof RegExp ? regex(v, item) : equal(v, encode(item)) || (Array.isArray(v) && v.some((child) => equal(child, encode(item))))))) return false;
		if (operator === "$nin" && list.some((v) => operand.some((item) => item instanceof RegExp ? regex(v, item) : equal(v, encode(item))))) return false;
		if (operator === "$all" && !operand.every((item) => list.some((v) => Array.isArray(v) && v.some((child) => item instanceof RegExp ? regex(child, item) : equal(child, encode(item)))))) return false;
		if (operator === "$regex" && !list.some((v) => regex(v, operand, condition.$options))) return false;
		if (operator === "$size" && !list.some((v) => Array.isArray(v) && v.length === operand)) return false;
		if (operator === "$elemMatch" && !list.some((v) => Array.isArray(v) && v.some((item) => matches(item, operand, vars)))) return false;
		if (operator === "$not" && matchesCondition(list, operand, vars)) return false;
		if (operator === "$type") {
			const ok = list.some((v) => operand === "string" ? typeof v === "string" : operand === "array" ? Array.isArray(v) : operand === "number" ? typeof v === "number" : operand === "objectId" ? v instanceof ObjectId || /^[a-f0-9]{24}$/i.test(String(v)) : v != null);
			if (!ok) return false;
		}
	}
	return true;
}

function matches(doc, filter = {}, vars = {}) {
	for (const [field, condition] of Object.entries(filter || {})) {
		if (field === "$and" && !condition.every((entry) => matches(doc, entry, vars))) return false;
		else if (field === "$or" && !condition.some((entry) => matches(doc, entry, vars))) return false;
		else if (field === "$nor" && condition.some((entry) => matches(doc, entry, vars))) return false;
		else if (field === "$expr" && !evaluate(condition, doc, vars)) return false;
		else if (!field.startsWith("$") && !matchesCondition(valuesAt(doc, field), condition, vars)) return false;
	}
	return true;
}

function evaluate(expression, doc, vars = {}) {
	if (typeof expression === "string") {
		if (expression.startsWith("$$")) {
			const [name, ...path] = expression.slice(2).split(".");
			return path.length ? getPath(vars[name], path) : vars[name];
		}
		if (expression.startsWith("$")) return getPath(doc, expression.slice(1));
		return expression;
	}
	if (expression == null || typeof expression !== "object") return expression;
	if (Array.isArray(expression)) return expression.map((item) => evaluate(item, doc, vars));
	const entries = Object.entries(expression);
	if (entries.length === 1 && entries[0][0].startsWith("$")) {
		const [op, raw] = entries[0];
		const args = Array.isArray(raw) ? raw.map((item) => evaluate(item, doc, vars)) : evaluate(raw, doc, vars);
		if (op === "$literal") return raw;
		if (op === "$ifNull") return args[0] == null ? args[1] : args[0];
		if (op === "$eq") return equal(args[0], args[1]);
		if (op === "$ne") return !equal(args[0], args[1]);
		if (op === "$gt") return comparable(args[0]) > comparable(args[1]);
		if (op === "$gte") return comparable(args[0]) >= comparable(args[1]);
		if (op === "$lt") return comparable(args[0]) < comparable(args[1]);
		if (op === "$lte") return comparable(args[0]) <= comparable(args[1]);
		if (op === "$and") return args.every(Boolean);
		if (op === "$or") return args.some(Boolean);
		if (op === "$not") return !args;
		if (op === "$in") return args[1]?.some((item) => equal(args[0], item));
		if (op === "$add") return args.reduce((sum, n) => sum + Number(n || 0), 0);
		if (op === "$subtract") return Number(args[0] || 0) - Number(args[1] || 0);
		if (op === "$multiply") return args.reduce((sum, n) => sum * Number(n || 0), 1);
		if (op === "$divide") return Number(args[0] || 0) / Number(args[1] || 1);
		if (op === "$round") return Number(Number(args[0] || 0).toFixed(Number(args[1] || 0)));
		if (op === "$size") return Array.isArray(args) ? args.length : 0;
		if (op === "$arrayElemAt") return args[0]?.[args[1]];
		if (op === "$first") return Array.isArray(args) ? args[0] : args;
		if (op === "$toString") return String(args ?? "");
		if (op === "$toDate") return new Date(args);
		if (op === "$hour") return new Date(args).getUTCHours();
		if (op === "$dateToString") {
			const date = new Date(evaluate(raw.date, doc, vars));
			return raw.format === "%Y-%m-%d" ? date.toISOString().slice(0, 10) : date.toISOString();
		}
		if (op === "$cond") return Array.isArray(raw) ? (args[0] ? args[1] : args[2]) : (evaluate(raw.if, doc, vars) ? evaluate(raw.then, doc, vars) : evaluate(raw.else, doc, vars));
		if (op === "$map") return (evaluate(raw.input, doc, vars) || []).map((item) => evaluate(raw.in, doc, { ...vars, [raw.as || "this"]: item }));
		if (op === "$filter") return (evaluate(raw.input, doc, vars) || []).filter((item) => evaluate(raw.cond, doc, { ...vars, [raw.as || "this"]: item }));
		if (op === "$setUnion") {
			const out = [];
			for (const value of args.flat()) if (!out.some((item) => equal(item, value))) out.push(value);
			return out;
		}
		if (op === "$let") {
			const scoped = { ...vars };
			for (const [name, value] of Object.entries(raw.vars || {})) scoped[name] = evaluate(value, doc, scoped);
			return evaluate(raw.in, doc, scoped);
		}
	}
	const out = {};
	for (const [key, value] of entries) out[key] = evaluate(value, doc, vars);
	return out;
}

function applyProjection(doc, spec = {}) {
	const include = Object.entries(spec).filter(([, value]) => value === 1 || (isPlain(value) && Object.keys(value).some((k) => k.startsWith("$"))) || (typeof value === "string" && value.startsWith("$")));
	if (include.length) {
		const out = {};
		if (spec._id !== 0 && doc._id !== undefined) out._id = doc._id;
		for (const [field, expression] of Object.entries(spec)) {
			if (expression === 0) continue;
			setPath(out, field, expression === 1 ? getPath(doc, field) : evaluate(expression, doc));
		}
		return out;
	}
	const out = structuredClone(encode(doc));
	if (doc._id instanceof ObjectId) out._id = doc._id;
	for (const [field, value] of Object.entries(spec)) if (value === 0) unsetPath(out, field);
	return out;
}

function sortDocs(docs, spec) {
	const entries = Object.entries(spec || {});
	return docs.sort((a, b) => {
		for (const [field, direction] of entries) {
			const av = comparable(getPath(a, field)), bv = comparable(getPath(b, field));
			if (equal(av, bv)) continue;
			if (av == null) return direction > 0 ? -1 : 1;
			if (bv == null) return direction > 0 ? 1 : -1;
			return (av < bv ? -1 : 1) * Number(direction);
		}
		return 0;
	});
}

function groupDocs(docs, spec) {
	const groups = new Map();
	for (const doc of docs) {
		const id = evaluate(spec._id, doc);
		const key = JSON.stringify(encode(id));
		if (!groups.has(key)) groups.set(key, { _id: id, __docs: [] });
		groups.get(key).__docs.push(doc);
	}
	return [...groups.values()].map((group) => {
		const out = { _id: group._id };
		for (const [field, accumulator] of Object.entries(spec)) {
			if (field === "_id") continue;
			const [op, expression] = Object.entries(accumulator)[0];
			const values = group.__docs.map((doc) => evaluate(expression, doc));
			if (op === "$sum") out[field] = values.reduce((sum, value) => sum + Number(value || 0), 0);
			else if (op === "$avg") out[field] = values.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, values.length);
			else if (op === "$min") out[field] = values.reduce((a, b) => comparable(a) < comparable(b) ? a : b);
			else if (op === "$max") out[field] = values.reduce((a, b) => comparable(a) > comparable(b) ? a : b);
			else if (op === "$first") out[field] = values[0];
			else if (op === "$last") out[field] = values.at(-1);
			else if (op === "$push") out[field] = values;
			else if (op === "$addToSet") out[field] = values.filter((value, index) => values.findIndex((item) => equal(item, value)) === index);
		}
		return out;
	});
}

async function runPipeline(source, pipeline, db) {
	let docs = source;
	for (const stage of pipeline || []) {
		if (stage.$match) docs = docs.filter((doc) => matches(doc, stage.$match));
		else if (stage.$sort) docs = sortDocs([...docs], stage.$sort);
		else if (stage.$skip != null) docs = docs.slice(stage.$skip);
		else if (stage.$limit != null) docs = docs.slice(0, stage.$limit);
		else if (stage.$count) docs = docs.length ? [{ [stage.$count]: docs.length }] : [];
		else if (stage.$project) docs = docs.map((doc) => applyProjection(doc, stage.$project));
		else if (stage.$addFields || stage.$set) docs = docs.map((doc) => {
			const out = { ...doc };
			for (const [field, expression] of Object.entries(stage.$addFields || stage.$set)) setPath(out, field, evaluate(expression, doc));
			return out;
		});
		else if (stage.$unwind) {
			const config = typeof stage.$unwind === "string" ? { path: stage.$unwind } : stage.$unwind;
			const path = config.path.replace(/^\$/, "");
			docs = docs.flatMap((doc) => {
				const list = getPath(doc, path);
				if (!Array.isArray(list) || !list.length) return config.preserveNullAndEmptyArrays ? [doc] : [];
				return list.map((value, index) => {
					const out = { ...doc }; setPath(out, path, value);
					if (config.includeArrayIndex) out[config.includeArrayIndex] = index;
					return out;
				});
			});
		}
		else if (stage.$group) docs = groupDocs(docs, stage.$group);
		else if (stage.$facet) {
			const result = {};
			for (const [name, child] of Object.entries(stage.$facet)) result[name] = await runPipeline([...docs], child, db);
			docs = [result];
		}
		else if (stage.$unionWith) {
			const config = typeof stage.$unionWith === "string" ? { coll: stage.$unionWith } : stage.$unionWith;
			const other = await db.collection(config.coll).find({}).toArray();
			docs = [...docs, ...(await runPipeline(other, config.pipeline || [], db))];
		}
		else if (stage.$lookup) {
			const foreign = await db.collection(stage.$lookup.from).find({}).toArray();
			docs = await Promise.all(docs.map(async (doc) => {
				let joined;
				if (stage.$lookup.localField) {
					joined = foreign.filter((item) => equal(getPath(doc, stage.$lookup.localField), getPath(item, stage.$lookup.foreignField)));
				} else joined = foreign;
				const vars = {};
				for (const [name, expression] of Object.entries(stage.$lookup.let || {})) vars[name] = evaluate(expression, doc);
				if (stage.$lookup.pipeline) {
					joined = joined.filter((item) => !stage.$lookup.pipeline[0]?.$match || matches(item, stage.$lookup.pipeline[0].$match, vars));
					joined = await runPipeline(joined, stage.$lookup.pipeline.slice(stage.$lookup.pipeline[0]?.$match ? 1 : 0), db);
				}
				return { ...doc, [stage.$lookup.as]: joined };
			}));
		}
		else throw new Error(`Unsupported Firestore compatibility aggregation stage: ${Object.keys(stage)[0]}`);
	}
	return docs;
}

function uniqueKeySets(name) {
	const configured = UNIQUE_KEYS[name];
	if (!configured) return [];
	return Array.isArray(configured[0]) ? configured : [configured];
}

function completeUniqueKey(name, keys, value) {
	const values = keys.map((key) => comparable(getPath(value, key)));
	if (values.some((item) => item === undefined || item === null || item === "" || isPlain(item))) return null;
	const canonical = `${name}\0${keys.join("\0")}\0${values.map(String).join("\0")}`;
	return { keys, values, id: createHash("sha256").update(canonical).digest("hex") };
}

export function firestoreUniqueReservations(name, value, targetId) {
	return uniqueKeySets(name)
		.map((keys) => completeUniqueKey(name, keys, value))
		.filter(Boolean)
		.map((key) => ({
			...key,
			targetId: String(comparable(targetId)),
			collection: name,
		}));
}

function deterministicId(name, filter) {
	return uniqueKeySets(name).map((keys) => completeUniqueKey(name, keys, filter)).find(Boolean)?.id.slice(0, 40) || null;
}

function duplicateKeyError(name, reservation, cause) {
	const error = new Error(`Duplicate unique key for ${name}: ${reservation?.keys?.join(", ") || "document id"}`);
	error.code = 11000;
	error.keyPattern = Object.fromEntries((reservation?.keys || []).map((key) => [key, 1]));
	error.cause = cause;
	return error;
}

function seedFromFilter(filter) {
	const out = {};
	for (const [key, value] of Object.entries(filter || {})) if (!key.startsWith("$") && !isPlain(value)) setPath(out, key, encode(value));
	return out;
}

function mutateUpdatePath(target, path, arrayFilters, updater) {
	const parts = String(path).split(".");
	function visit(node, index) {
		const part = parts[index];
		if (index === parts.length - 1) {
			if (part.startsWith("$[")) return;
			const result = updater(node?.[part]);
			if (result === undefined) delete node[part]; else node[part] = result;
			return;
		}
		const alias = /^\$\[([^\]]*)\]$/.exec(part);
		if (alias) {
			if (!Array.isArray(node)) return;
			const name = alias[1];
			const clauses = (arrayFilters || []).flatMap((filter) => Object.entries(filter).filter(([key]) => key === name || key.startsWith(`${name}.`)).map(([key, value]) => [key === name ? "" : key.slice(name.length + 1), value]));
			for (const item of node) {
				const allowed = !name || clauses.every(([field, condition]) => field ? matchesCondition(valuesAt(item, field), condition) : matchesCondition(item, condition));
				if (allowed) visit(item, index + 1);
			}
			return;
		}
		if (!isPlain(node[part]) && !Array.isArray(node[part])) node[part] = {};
		visit(node[part], index + 1);
	}
	visit(target, 0);
}

function applyUpdate(doc, update, inserting = false, arrayFilters = []) {
	const out = { ...doc };
	if (!Object.keys(update).some((key) => key.startsWith("$"))) return { ...encode(update), _id: doc._id };
	for (const [op, values] of Object.entries(update)) {
		if (op === "$set" || (op === "$setOnInsert" && inserting)) for (const [path, value] of Object.entries(values)) mutateUpdatePath(out, path, arrayFilters, () => encode(value));
		else if (op === "$unset") for (const path of Object.keys(values)) mutateUpdatePath(out, path, arrayFilters, () => undefined);
		else if (op === "$inc") for (const [path, value] of Object.entries(values)) mutateUpdatePath(out, path, arrayFilters, (current) => Number(current || 0) + Number(value));
		else if (op === "$max") for (const [path, value] of Object.entries(values)) mutateUpdatePath(out, path, arrayFilters, (current) => current == null || comparable(value) > comparable(current) ? encode(value) : current);
		else if (op === "$min") for (const [path, value] of Object.entries(values)) mutateUpdatePath(out, path, arrayFilters, (current) => current == null || comparable(value) < comparable(current) ? encode(value) : current);
		else if (op === "$push") for (const [path, value] of Object.entries(values)) {
			const current = Array.isArray(getPath(out, path)) ? [...getPath(out, path)] : [];
			if (isPlain(value) && value.$each) current.push(...encode(value.$each)); else current.push(encode(value));
			if (value?.$slice != null) current.splice(0, Math.max(0, current.length - Math.abs(value.$slice)));
			setPath(out, path, current);
		}
		else if (op === "$addToSet") for (const [path, value] of Object.entries(values)) {
			const current = Array.isArray(getPath(out, path)) ? [...getPath(out, path)] : [];
			const additions = value?.$each || [value];
			for (const item of additions) if (!current.some((existing) => equal(existing, encode(item)))) current.push(encode(item));
			setPath(out, path, current);
		}
		else if (op === "$pull") for (const [path, value] of Object.entries(values)) setPath(out, path, (getPath(out, path) || []).filter((item) => !matchesCondition(item, value)));
	}
	return out;
}

class Cursor {
	constructor(collection, filter = {}, options = {}) { this.collection = collection; this.filter = filter; this.options = options; this.sortSpec = null; this.skipCount = 0; this.limitCount = null; this.projection = options.projection || null; }
	sort(spec) { this.sortSpec = spec; return this; }
	skip(count) { this.skipCount = count; return this; }
	limit(count) { this.limitCount = count; return this; }
	project(spec) { this.projection = spec; return this; }
	async toArray() {
		let docs = await this.collection._read(this.filter, {
			sort: this.sortSpec,
			skip: this.skipCount,
			limit: this.limitCount,
		});
		if (this.sortSpec) docs = sortDocs(docs, this.sortSpec);
		if (this.skipCount) docs = docs.slice(this.skipCount);
		if (this.limitCount != null) docs = docs.slice(0, this.limitCount);
		if (this.projection) docs = docs.map((doc) => applyProjection(doc, this.projection));
		return docs;
	}
	async *[Symbol.asyncIterator]() { for (const item of await this.toArray()) yield item; }
}

class FirestoreCollection {
	constructor(db, name) {
		this.db = db;
		this.collectionName = name;
		this.sourceCatalog = name === "job_market" ? "market" : name === "external_scraped_jobs" ? "external" : null;
		this.ref = db.firestore.collection(this.sourceCatalog ? "jobs" : name);
	}
	_filterWithCatalog(filter = {}) {
		return this.sourceCatalog ? { $and: [{ sourceCatalog: this.sourceCatalog }, filter] } : filter;
	}
	_queryFromPlan(plan) {
		let query = this.ref;
		for (const clause of plan.clauses) query = query.where(clause.field, clause.operator, clause.value);
		return query;
	}
	async _read(filter = {}, hints = {}) {
		const id = filter?._id;
		filter = this._filterWithCatalog(filter);
		if (id && !isPlain(id)) {
			const snap = await this.ref.doc(String(comparable(id))).get();
			const docs = snap.exists ? [decodeDoc(snap.id, snap.data())] : [];
			return docs.filter((doc) => matches(doc, filter));
		}
		const documentIds = conjunctiveDocumentIds(filter);
		if (documentIds) {
			const refs = [...new Set(documentIds)].map((documentId) => this.ref.doc(documentId));
			if (!refs.length) return [];
			const snapshots = await this.db.firestore.getAll(...refs);
			return snapshots
				.filter((snapshot) => snapshot.exists)
				.map((snapshot) => decodeDoc(snapshot.id, snapshot.data()))
				.filter((doc) => matches(doc, filter));
		}
		const plan = buildNativeQueryPlan(filter);
		let query = this._queryFromPlan(plan);
		const sortEntries = Object.entries(hints.sort || {});
		const inequalityField = plan.clauses.find((clause) => [">", ">=", "<", "<="].includes(clause.operator))?.field;
		const nativeSort = plan.complete &&
			sortEntries.every(([field, direction]) => field !== "_id" && [1, -1].includes(Number(direction))) &&
			(!inequalityField || !sortEntries.length || sortEntries[0][0] === inequalityField);
		if (nativeSort) {
			for (const [field, direction] of sortEntries) query = query.orderBy(field, Number(direction) < 0 ? "desc" : "asc");
		}
		if (plan.complete && nativeSort && hints.limit != null) query = query.limit(Math.max(1, Number(hints.skip || 0) + Number(hints.limit)));
		const snapshot = await query.get();
		const warnAt = Math.max(1, Number(process.env.FIRESTORE_COMPAT_WARN_SCAN || 1000));
		const maxScan = Math.max(warnAt, Number(process.env.FIRESTORE_COMPAT_MAX_SCAN || 20000));
		const scanKey = `${this.collectionName}:${plan.complete ? "native" : "fallback"}`;
		if (snapshot.size >= warnAt && !warnedScans.has(scanKey)) {
			warnedScans.add(scanKey);
			console.warn(`[firestore-adapter] ${scanKey} read scanned ${snapshot.size} documents; add a native indexed query or reduce the page size`);
		}
		if (snapshot.size > maxScan) {
			const error = new Error(`[firestore-adapter] ${this.collectionName} query scanned ${snapshot.size} documents (limit ${maxScan})`);
			error.code = "FIRESTORE_COMPAT_SCAN_LIMIT";
			throw error;
		}
		return snapshot.docs.map((doc) => decodeDoc(doc.id, doc.data())).filter((doc) => matches(doc, filter));
	}
	find(filter = {}, options = {}) { return new Cursor(this, filter, options); }
	async findOne(filter = {}, options = {}) { return (await this.find(filter, options).sort(options.sort || {}).limit(1).toArray())[0] || null; }
	async insertOne(doc) {
		const id = String(comparable(doc._id || deterministicId(this.collectionName, doc) || new ObjectId()));
		const data = encode({ ...doc, ...(this.sourceCatalog ? { sourceCatalog: this.sourceCatalog } : {}) }); delete data._id;
		assertFirestoreDocumentSize(data, `${this.collectionName}/${id}`);
		const batch = this.db.firestore.batch();
		batch.create(this.ref.doc(id), data);
		const reservations = firestoreUniqueReservations(this.collectionName, data, id);
		for (const reservation of reservations) {
			batch.create(this.db.firestore.collection("unique_reservations").doc(reservation.id), {
				collection: reservation.collection,
				keys: reservation.keys,
				values: reservation.values.map(String),
				targetId: id,
				createdAt: new Date(),
			});
		}
		const outboxId = this._outbox(batch, id, "upsert");
		try {
			await batch.commit();
		} catch (error) {
			if (Number(error?.code) === 6 || String(error?.code) === "ALREADY_EXISTS") throw duplicateKeyError(this.collectionName, reservations[0], error);
			throw error;
		}
		this._kickOutbox(outboxId);
		return { acknowledged: true, insertedId: /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : id };
	}
	async insertMany(docs) { const ids = []; for (const doc of docs) ids.push((await this.insertOne(doc)).insertedId); return { acknowledged: true, insertedCount: ids.length, insertedIds: Object.fromEntries(ids.map((id, i) => [i, id])) }; }
	async updateOne(filter, update, options = {}) {
		let found = await this.findOne(filter);
		if (!found && !options.upsert) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
		if (!found) found = { ...seedFromFilter(filter), ...(this.sourceCatalog ? { sourceCatalog: this.sourceCatalog } : {}), _id: deterministicId(this.collectionName, filter) || new ObjectId() };
		const id = String(comparable(found._id));
		let inserting = false;
		let matched = false;
		const outboxRef = this.sourceCatalog ? this.db.firestore.collection("search_outbox").doc() : null;
		await this.db.firestore.runTransaction(async (transaction) => {
			const ref = this.ref.doc(id);
			const snapshot = await transaction.get(ref);
			let current;
			if (snapshot.exists) {
				current = decodeDoc(snapshot.id, snapshot.data());
				if (!matches(current, this.sourceCatalog ? { $and: [{ sourceCatalog: this.sourceCatalog }, filter] } : filter)) return;
				matched = true;
			} else {
				if (!options.upsert) return;
				inserting = true;
				current = found;
			}
			const next = applyUpdate(current, update, inserting, options.arrayFilters || []); delete next._id;
			const encoded = encode(next);
			assertFirestoreDocumentSize(encoded, `${this.collectionName}/${id}`);
			const beforeReservations = firestoreUniqueReservations(this.collectionName, current, id);
			const afterReservations = firestoreUniqueReservations(this.collectionName, encoded, id);
			const reservations = new Map([...beforeReservations, ...afterReservations].map((item) => [item.id, item]));
			const reservationSnapshots = new Map();
			for (const reservation of reservations.values()) {
				const reservationRef = this.db.firestore.collection("unique_reservations").doc(reservation.id);
				reservationSnapshots.set(reservation.id, await transaction.get(reservationRef));
			}
			for (const reservation of afterReservations) {
				const reserved = reservationSnapshots.get(reservation.id);
				if (reserved.exists && String(reserved.data()?.targetId || "") !== id) throw duplicateKeyError(this.collectionName, reservation);
			}
			transaction.set(ref, encoded, { merge: false });
			const afterIds = new Set(afterReservations.map((item) => item.id));
			for (const reservation of beforeReservations) {
				if (!afterIds.has(reservation.id) && String(reservationSnapshots.get(reservation.id)?.data()?.targetId || "") === id) {
					transaction.delete(this.db.firestore.collection("unique_reservations").doc(reservation.id));
				}
			}
			for (const reservation of afterReservations) {
				transaction.set(this.db.firestore.collection("unique_reservations").doc(reservation.id), {
					collection: reservation.collection,
					keys: reservation.keys,
					values: reservation.values.map(String),
					targetId: id,
					updatedAt: new Date(),
				}, { merge: true });
			}
			if (outboxRef) transaction.set(outboxRef, { jobId: id, operation: "upsert", status: "pending", attempts: 0, createdAt: new Date() });
		});
		if (!matched && !inserting) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
		this._kickOutbox(outboxRef?.id);
		return { acknowledged: true, matchedCount: inserting ? 0 : 1, modifiedCount: 1, ...(inserting ? { upsertedCount: 1, upsertedId: found._id } : {}) };
	}
	async updateMany(filter, update, options = {}) { const docs = await this._read(filter); if (!docs.length && options.upsert) return this.updateOne(filter, update, options); for (const doc of docs) await this.updateOne({ _id: doc._id }, update, options); return { acknowledged: true, matchedCount: docs.length, modifiedCount: docs.length }; }
	async replaceOne(filter, replacement, options = {}) { return this.updateOne(filter, replacement, options); }
	async findOneAndUpdate(filter, update, options = {}) { const before = await this.findOne(filter, options); const result = await this.updateOne(filter, update, options); const after = await this.findOne(result.upsertedId ? { _id: result.upsertedId } : filter, options); return options.returnDocument === "before" ? before : after; }
	_outbox(batch, id, operation) {
		if (!this.sourceCatalog) return null;
		const ref = this.db.firestore.collection("search_outbox").doc();
		batch.set(ref, { jobId: id, operation, status: "pending", attempts: 0, createdAt: new Date() });
		return ref.id;
	}
	_kickOutbox(outboxId) {
		if (!outboxId) return;
		if (process.env.BACKGROUND_WORKERS_MODE !== "tasks") return;
		void import("../services/cloudTasks.js")
			.then(({ enqueueSearchOutboxTask }) => enqueueSearchOutboxTask(outboxId))
			.catch((error) => console.warn("[search-outbox] task enqueue failed; scheduler will retry:", error?.message || error));
	}
	async deleteOne(filter) {
		const doc = await this.findOne(filter); if (!doc) return { acknowledged: true, deletedCount: 0 };
		const id = String(comparable(doc._id));
		const batch = this.db.firestore.batch();
		batch.delete(this.ref.doc(id));
		for (const reservation of firestoreUniqueReservations(this.collectionName, doc, id)) {
			batch.delete(this.db.firestore.collection("unique_reservations").doc(reservation.id));
		}
		const outboxId = this._outbox(batch, id, "delete");
		await batch.commit();
		this._kickOutbox(outboxId);
		return { acknowledged: true, deletedCount: 1 };
	}
	async deleteMany(filter) {
		const docs = await this._read(filter);
		for (const doc of docs) await this.deleteOne({ _id: doc._id });
		return { acknowledged: true, deletedCount: docs.length };
	}
	async countDocuments(filter = {}) {
		if (filter?._id && !isPlain(filter._id)) return (await this._read(filter)).length;
		const normalized = this._filterWithCatalog(filter);
		if (conjunctiveDocumentIds(normalized)) return (await this._read(filter)).length;
		const plan = buildNativeQueryPlan(normalized);
		if (!plan.complete) return (await this._read(filter)).length;
		return (await this._queryFromPlan(plan).count().get()).data().count;
	}
	async estimatedDocumentCount() { return this.countDocuments({}); }
	async distinct(field, filter = {}) { const values = (await this._read(filter)).flatMap((doc) => valuesAt(doc, field)); return values.filter((value, index) => values.findIndex((item) => equal(item, value)) === index); }
	aggregate(pipeline) { return { toArray: async () => runPipeline(await this.find({}).toArray(), pipeline, this.db), [Symbol.asyncIterator]: async function* () { for (const item of await this.toArray()) yield item; } }; }
	async bulkWrite(operations) { let insertedCount = 0, modifiedCount = 0, deletedCount = 0, upsertedCount = 0; for (const op of operations) { if (op.insertOne) { await this.insertOne(op.insertOne.document); insertedCount += 1; } else if (op.updateOne) { const r = await this.updateOne(op.updateOne.filter, op.updateOne.update, op.updateOne); modifiedCount += r.modifiedCount; upsertedCount += r.upsertedCount || 0; } else if (op.deleteOne) { deletedCount += (await this.deleteOne(op.deleteOne.filter)).deletedCount; } else if (op.replaceOne) { const r = await this.replaceOne(op.replaceOne.filter, op.replaceOne.replacement, op.replaceOne); modifiedCount += r.modifiedCount; upsertedCount += r.upsertedCount || 0; } } return { acknowledged: true, insertedCount, modifiedCount, deletedCount, upsertedCount }; }
	async createIndex() { return "firestore-managed-index"; }
	async dropIndex() { return true; }
}

class FirestoreDbAdapter {
	constructor() { this.firestore = getFirestoreDb(); this.cache = new Map(); }
	collection(name) { if (!this.cache.has(name)) this.cache.set(name, new FirestoreCollection(this, name)); return this.cache.get(name); }
	async command(command) { if (command?.ping) { await this.firestore.collection("_health").doc("ping").get(); return { ok: 1 }; } return { ok: 1 }; }
	listCollections() { return { toArray: async () => (await this.firestore.listCollections()).map((ref) => ({ name: ref.id })) }; }
}

export function createFirestoreMongoAdapter() {
	return new FirestoreDbAdapter();
}

export const firestoreAdapterTest = { matches, applyUpdate, runPipeline, evaluate, applyProjection, buildNativeQueryPlan, conjunctiveDocumentIds };
