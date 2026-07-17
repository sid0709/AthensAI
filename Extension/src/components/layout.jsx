import * as React from 'react';
import PropTypes from 'prop-types';
import {
	Tabs,
	Tab,
	Box,
	Typography,
} from '@mui/material';

import {
	TravelExplore,
	ZoomIn,
} from '@mui/icons-material';

import ComponentTracker from './Tracker';
import ScrapperPage from './Scrapper';
import BackendTrafficLight from './BackendTrafficLight';
import { athensDisplayFont } from '../theme/athensTheme';

function CustomTabPanel(props) {
	const { children, value, index, ...other } = props;

	return (
		<div
			role="tabpanel"
			hidden={value !== index}
			id={`simple-tabpanel-${index}`}
			aria-labelledby={`simple-tab-${index}`}
			{...other}
		>
			{value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
		</div>
	);
}

CustomTabPanel.propTypes = {
	children: PropTypes.node,
	index: PropTypes.number.isRequired,
	value: PropTypes.number.isRequired,
};

function a11yProps(index) {
	return {
		id: `simple-tab-${index}`,
		'aria-controls': `simple-tabpanel-${index}`,
	};
}

const TabInfo = [
	{
		label: 'Scrap',
		content: <ScrapperPage />,
		icon: <TravelExplore sx={{ fontSize: 18 }} />,
	},
	{
		label: 'Tracker',
		content: <ComponentTracker />,
		icon: <ZoomIn sx={{ fontSize: 18 }} />,
	},
];

export default function LayoutPage() {
	const [value, setValue] = React.useState(0);

	const handleChange = (event, newValue) => {
		setValue(newValue);
	};

	return (
		<Box sx={{ width: '100%', maxWidth: 420, mx: 'auto' }}>
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: 1.5,
					mb: 2,
					pb: 2,
					borderBottom: '1px solid',
					borderColor: 'divider',
				}}
			>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
					<Box
						component="img"
						src="/logo.png"
						alt="AutoLancer"
						sx={{
							width: 40,
							height: 40,
							borderRadius: 3,
							objectFit: 'cover',
							flexShrink: 0,
							boxShadow: '0 4px 20px rgba(124, 110, 245, 0.22)',
						}}
					/>
					<Box sx={{ minWidth: 0 }}>
						<Typography
							sx={{
								fontFamily: athensDisplayFont,
								fontSize: '1.05rem',
								fontWeight: 700,
								letterSpacing: '-0.02em',
								lineHeight: 1.2,
							}}
						>
							AutoLancer
						</Typography>
						<Typography
							variant="caption"
							sx={{ color: 'text.secondary', lineHeight: 1.3 }}
						>
							Extension · Athens design
						</Typography>
					</Box>
				</Box>
				<BackendTrafficLight />
			</Box>

			<Box
				sx={{
					p: 0.75,
					borderRadius: 3,
					bgcolor: 'background.default',
					border: '1px solid',
					borderColor: 'divider',
					mb: 0.5,
				}}
			>
				<Tabs
					value={value}
					onChange={handleChange}
					aria-label="extension tabs"
					variant="fullWidth"
				>
					{TabInfo.map((tab, index) => (
						<Tab
							key={index}
							label={tab.label}
							icon={tab.icon}
							iconPosition="start"
							{...a11yProps(index)}
						/>
					))}
				</Tabs>
			</Box>

			{TabInfo.map((tab, index) => (
				<CustomTabPanel key={index} value={value} index={index}>
					{tab.content}
				</CustomTabPanel>
			))}
		</Box>
	);
}
