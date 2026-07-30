import { AI_API_USAGE_COLLECTION } from '@nextoffer/shared/ai-api-usage';
import { backfillJobIdentityRegistry } from '../services/jobIdentityDedupe.js';
import { createFirestoreDataAdapter } from './firestoreDataAdapter.js';

let dataStore;
let jobsCollection;
let companyCategoryCollection;
let personalInfoCollection;
let accountInfoCollection;
let rulesCollection;
let vendorTasksCollection;
let bidReviewEventsCollection;
let skillEnrichmentQueueCollection;
let skillCooccurrenceCollection;
let userKnowledgeGraphsCollection;
let resumeGeneratorConfigCollection;
let resumeGenerationsCollection;
let mailMessagesCollection;
let mailSyncStateCollection;
let mailUserLabelsCollection;
let userResumesCollection;
let resumeTemplatesCollection;
let avalonRunsCollection;
let jobMatchScoresCollection;
let matchProfileStateCollection;
let userSkillsCollection;
let skillDictionaryCollection;
let externalScrapedJobsCollection;
let companiesCollection;
let companyAliasesCollection;
let jobIdentityRegistryCollection;
let aiApiUsageCollection;
let llmCallLogCollection;
let backgroundTasksCollection;
let backgroundTaskInputsCollection;

function bindCollections(db) {
	jobsCollection = db.collection('job_market');
	companyCategoryCollection = db.collection('company_category');
	personalInfoCollection = db.collection('personal_info');
	accountInfoCollection = db.collection('account_info');
	rulesCollection = db.collection('rules');
	vendorTasksCollection = db.collection('vendor_tasks');
	bidReviewEventsCollection = db.collection('bid_review_events');
	skillEnrichmentQueueCollection = db.collection('skill_enrichment_queue');
	skillCooccurrenceCollection = db.collection('skill_cooccurrence');
	userKnowledgeGraphsCollection = db.collection('user_knowledge_graphs');
	resumeGeneratorConfigCollection = db.collection('resume_generator_config');
	resumeGenerationsCollection = db.collection('resume_generations');
	mailMessagesCollection = db.collection('mail_messages');
	mailSyncStateCollection = db.collection('mail_sync_state');
	mailUserLabelsCollection = db.collection('mail_user_labels');
	userResumesCollection = db.collection('user_resumes');
	resumeTemplatesCollection = db.collection('resume_templates');
	avalonRunsCollection = db.collection('avalon_apply_runs');
	jobMatchScoresCollection = db.collection('job_match_scores');
	matchProfileStateCollection = db.collection('match_profile_state');
	userSkillsCollection = db.collection('user_skills');
	skillDictionaryCollection = db.collection('skill_dictionary');
	externalScrapedJobsCollection = db.collection('external_scraped_jobs');
	companiesCollection = db.collection('companies');
	companyAliasesCollection = db.collection('company_aliases');
	jobIdentityRegistryCollection = db.collection('job_identity_registry');
	aiApiUsageCollection = db.collection(AI_API_USAGE_COLLECTION);
	llmCallLogCollection = aiApiUsageCollection;
	backgroundTasksCollection = db.collection('background_tasks');
	backgroundTaskInputsCollection = db.collection('background_task_inputs');
}

export async function initDataStore() {
	if (dataStore) return dataStore;
	dataStore = createFirestoreDataAdapter();
	bindCollections(dataStore);

	const identityBackfill = await backfillJobIdentityRegistry(jobsCollection, jobIdentityRegistryCollection);
	if (!identityBackfill.alreadyComplete) {
		console.log(`[job-identity] backfilled ${identityBackfill.identities || 0} identities from ${identityBackfill.scanned || 0} jobs`);
	}

	// Warm the most common first page without blocking startup on a cache fill.
	void Promise.all([
		jobsCollection.find({}, { projection: { description: 0, jobDescription: 0 } }).sort({ postedAt: -1, _id: -1 }).limit(25).toArray(),
		jobsCollection.find({ extensionV2: false }, { projection: { description: 0, jobDescription: 0 } }).sort({ postedAt: -1, _id: -1 }).limit(25).toArray(),
		jobsCollection.countDocuments({ extensionV2: false }),
		jobsCollection.countDocuments({}),
	]).catch((error) => console.warn('[firestore] first job page warmup failed:', error?.message || error));

	console.log('Connected to native Firestore database (default)');
	return dataStore;
}

export function getDataStore() {
	return dataStore || null;
}

export function getVendorTasksCollection() {
	return vendorTasksCollection || null;
}

export function getBidReviewEventsCollection() {
	return bidReviewEventsCollection || null;
}

export async function closeDataStore() {
	dataStore = null;
	jobsCollection = null;
	companyCategoryCollection = null;
	personalInfoCollection = null;
	accountInfoCollection = null;
	rulesCollection = null;
	vendorTasksCollection = null;
	bidReviewEventsCollection = null;
	skillEnrichmentQueueCollection = null;
	skillCooccurrenceCollection = null;
	userKnowledgeGraphsCollection = null;
	resumeGeneratorConfigCollection = null;
	resumeGenerationsCollection = null;
	mailMessagesCollection = null;
	mailSyncStateCollection = null;
	mailUserLabelsCollection = null;
	userResumesCollection = null;
	resumeTemplatesCollection = null;
	avalonRunsCollection = null;
	jobMatchScoresCollection = null;
	matchProfileStateCollection = null;
	userSkillsCollection = null;
	skillDictionaryCollection = null;
	externalScrapedJobsCollection = null;
	companiesCollection = null;
	companyAliasesCollection = null;
	jobIdentityRegistryCollection = null;
	aiApiUsageCollection = null;
	llmCallLogCollection = null;
	backgroundTasksCollection = null;
	backgroundTaskInputsCollection = null;
}

export {
	jobsCollection,
	companyCategoryCollection,
	personalInfoCollection,
	accountInfoCollection,
	rulesCollection,
	vendorTasksCollection,
	bidReviewEventsCollection,
	skillEnrichmentQueueCollection,
	skillCooccurrenceCollection,
	userKnowledgeGraphsCollection,
	resumeGeneratorConfigCollection,
	resumeGenerationsCollection,
	mailMessagesCollection,
	mailSyncStateCollection,
	mailUserLabelsCollection,
	userResumesCollection,
	resumeTemplatesCollection,
	avalonRunsCollection,
	jobMatchScoresCollection,
	matchProfileStateCollection,
	userSkillsCollection,
	skillDictionaryCollection,
	externalScrapedJobsCollection,
	companiesCollection,
	companyAliasesCollection,
	jobIdentityRegistryCollection,
	aiApiUsageCollection,
	llmCallLogCollection,
	backgroundTasksCollection,
	backgroundTaskInputsCollection,
};
