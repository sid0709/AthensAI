import type { ComponentType } from "react";
import type { View } from "../types";
import { JobSearchPage } from "../features/job-search/JobSearchPage";
import { ResumesPage } from "../features/resumes/ResumesPage";
import { MailPage } from "../features/mail/MailPage";
import { CalendarPage } from "../features/calendar/CalendarPage";
import { AnalyticsPage } from "../features/analytics/AnalyticsPage";
import { AiUsagePage } from "../features/ai-usage/AiUsagePage";
import { ApiUsageMonitorPage } from "../features/api-usage-monitor/ApiUsageMonitorPage";
import { FirebaseExplorerPage } from "../features/firebase-explorer/FirebaseExplorerPage";
import { BidManagementPage } from "../features/bid-management/BidManagementPage";
import { AppsPluginsPage } from "../features/apps-plugins/AppsPluginsPage";
import { ChangelogPage } from "../features/changelog/ChangelogPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { NotionPage } from "../features/notion/NotionPage";
import { TitleReviewPage } from "../features/title-review/TitleReviewPage";

export const VIEW_COMPONENTS: Record<View, ComponentType> = {
  "job-board": JobSearchPage,
  "title-review": TitleReviewPage,
  resumes: ResumesPage,
  mail: MailPage,
  calendar: CalendarPage,
  notion: NotionPage,
  reports: AnalyticsPage,
  "ai-usage": AiUsagePage,
  "api-usage-monitor": ApiUsageMonitorPage,
  firebase: FirebaseExplorerPage,
  "bid-management": BidManagementPage,
  "apps-plugins": AppsPluginsPage,
  changelog: ChangelogPage,
  settings: SettingsPage,
};
