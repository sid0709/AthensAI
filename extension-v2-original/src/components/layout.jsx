import * as React from 'react';
import PropTypes from 'prop-types';
import {
	Tabs,
	Tab,
	Box
} from '@mui/material';

import {
	TravelExplore,
} from '@mui/icons-material';

import ScrapperPage from './Scrapper';
import BackendTrafficLight from './BackendTrafficLight';

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
			{value === index && <Box sx={{ p: 3 }}>{children}</Box>}
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
		icon: <TravelExplore />,
	},
];

export default function LayoutPage() {
	const [value, setValue] = React.useState(0);

	const handleChange = (event, newValue) => {
		setValue(newValue);
	};

	return (
		<Box sx={{ width: '100%' }}>
			<Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
				<BackendTrafficLight />
			</Box>
			<Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
				<Tabs value={value} onChange={handleChange} aria-label="extension tabs" centered>
					{TabInfo.map((tab, index) => (
						<Tab
							key={index}
							label={tab.label}
							icon={tab.icon}
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
