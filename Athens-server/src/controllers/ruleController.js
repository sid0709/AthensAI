import { rulesCollection } from '../db/mongo.js';
import { invalidateRulesCache } from '../utils/ruleMatcher.js';

export async function getRules(req, res) {
	try {
		const rules = await rulesCollection.find({}).toArray();
		res.status(200).json(rules);
	} catch (error) {
		console.error('Failed to get rules', error);
		res.status(500).json({ error: 'Failed to get rules' });
	}
}

export async function createRule(req, res) {
	try {
		const ruleSet = req.body;
		if (!ruleSet || !ruleSet.name) {
			return res.status(400).json({ error: 'Rule set name is required' });
		}

		const existingRule = await rulesCollection.findOne({ name: ruleSet.name });
		if (existingRule) {
			return res.status(409).json({ error: 'A rule with this name already exists' });
		}

		const result = await rulesCollection.insertOne(ruleSet);
		const createdRule = { ...ruleSet, _id: result.insertedId };
		invalidateRulesCache();
		res.status(201).json(createdRule);
	} catch (error) {
		console.error('Failed to create rule', error);
		res.status(500).json({ error: 'Failed to create rule' });
	}
}

export async function updateRule(req, res) {
	try {
		const { name } = req.params;
		const updates = req.body;

		if (!updates || !updates.name) {
			return res.status(400).json({ error: 'Rule set name is required' });
		}

		const existingRule = await rulesCollection.findOne({ name });
		if (!existingRule) {
			return res.status(404).json({ error: 'Rule not found' });
		}

		if (updates.name !== name) {
			const conflictingRule = await rulesCollection.findOne({ name: updates.name });
			if (conflictingRule) {
				return res.status(409).json({ error: 'A rule with this name already exists' });
			}
		}

		const serializedUpdate = {
			name: updates.name,
			rules: Array.isArray(updates.rules) ? updates.rules : existingRule.rules,
			logicalOperators: Array.isArray(updates.logicalOperators) ? updates.logicalOperators : existingRule.logicalOperators,
		};

		const updatedRule = await rulesCollection.findOneAndUpdate(
			{ name },
			{ $set: serializedUpdate },
			{ returnDocument: 'after' },
		);

		const normalizedRule = updatedRule?.value ?? updatedRule;

		if (!normalizedRule) {
			return res.status(404).json({ error: 'Rule not found' });
		}

		invalidateRulesCache();
		res.status(200).json(normalizedRule);
	} catch (error) {
		console.error('Failed to update rule', error);
		res.status(500).json({ error: 'Failed to update rule' });
	}
}

export async function deleteRule(req, res) {
	try {
		const { name } = req.params;
		const result = await rulesCollection.deleteOne({ name });
		if (result.deletedCount === 0) {
			return res.status(404).json({ error: 'Rule not found' });
		}
		invalidateRulesCache();
		res.status(200).json({ message: 'Rule deleted successfully' });
	} catch (error) {
		console.error('Failed to delete rule', error);
		res.status(500).json({ error: 'Failed to delete rule' });
	}
}
