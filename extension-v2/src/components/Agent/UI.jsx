import { Button, Paper, Box, Stack, Typography, TextField, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import ResponseTreeView from './reference/ResponseTreeView.jsx';

export function AgentUI({
	onAnalyze,
	onExecute,
	loading,
	executing,
	error,
	profiles,
	profileIdentifier,
	onProfileChange,
	jobDescription,
	onJobDescriptionChange,
	componentsData,
	analysisData,
	hasExecutableActions,
	executionReport
}) {
	return (
		<Box sx={{ p: 2, maxWidth: 1000, margin: 'auto' }}>
			<Paper elevation={2} sx={{ p: 2, mb: 2 }}>
				<Stack spacing={2}>
					<Typography variant="h5">Agent</Typography>
					<FormControl fullWidth>
						<InputLabel id="autolancer-profile-select-label">Profile</InputLabel>
						<Select
							labelId="autolancer-profile-select-label"
							label="Profile"
							value={profileIdentifier || ''}
							onChange={(e) => onProfileChange?.(e.target.value)}
						>
							{(profiles || []).map((p) => (
								<MenuItem key={p.identifier} value={p.identifier}>
									{p.label || p.identifier}
								</MenuItem>
							))}
						</Select>
					</FormControl>
					<TextField
						label="Job Description (optional)"
						placeholder="Paste the job description here to improve AI answers"
						value={jobDescription}
						onChange={(e) => onJobDescriptionChange?.(e.target.value)}
						multiline
						minRows={4}
						fullWidth
					/>
					<Box sx={{ display: 'flex', gap: 2 }}>
						<Button variant="contained" color="primary" onClick={onAnalyze} fullWidth disabled={loading}>
							Highlight & Collect
						</Button>
						<Button variant="contained" color="success" onClick={onExecute} fullWidth disabled={!hasExecutableActions || loading || executing}>
							{executing ? 'Executing...' : 'Execute Actions'}
						</Button>
					</Box>
					{loading && <Typography variant="body2">Analyzing with AI...</Typography>}
					{executing && <Typography variant="body2">Filling text fields...</Typography>}
					{error && (
						<Typography variant="body2" color="error">
							{String(error)}
						</Typography>
					)}
				</Stack>
			</Paper>

			{componentsData && (
				<Paper elevation={1} sx={{ p: 2, mb: 2 }}>
					<Typography variant="subtitle1" sx={{ mb: 1 }}>Detected Components</Typography>
					<ResponseTreeView data={componentsData} />
				</Paper>
			)}

			{analysisData && (
				<Paper elevation={1} sx={{ p: 2 }}>
					<Typography variant="subtitle1" sx={{ mb: 1 }}>AI Analysis</Typography>
					<ResponseTreeView data={analysisData} />
				</Paper>
			)}

			{executionReport && (
				<Paper elevation={1} sx={{ p: 2, mt: 2 }}>
					<Typography variant="subtitle1" sx={{ mb: 1 }}>Execution Result</Typography>
					<ResponseTreeView data={executionReport} />
				</Paper>
			)}
		</Box>
	);
}
