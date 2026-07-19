import { Navigate, Route, Routes } from "react-router";
import { SignInPage } from "../features/auth/SignInPage";
import { SignUpPage } from "../features/auth/SignUpPage";
import { PATHS } from "../config/routes";
import { VIEW_COMPONENTS } from "../config/views";
import { AppLayout } from "./AppLayout";
import { ProtectedRoute } from "./ProtectedRoute";
import { AdminRoute } from "./AdminRoute";

const {
  dashboard: DashboardPage,
  "job-board": JobSearchPage,
  resumes: ResumesPage,
  ats: ApplicationsPage,
  copilot: CopilotPage,
  agents: AgentsPage,
  mail: MailPage,
  calendar: CalendarPage,
  interviews: InterviewPrepPage,
  reports: AnalyticsPage,
  "ai-usage": AiUsagePage,
  "api-usage-monitor": ApiUsageMonitorPage,
  firebase: FirebaseExplorerPage,
  "bid-management": BidManagementPage,
  "apps-plugins": AppsPluginsPage,
  settings: SettingsPage,
} = VIEW_COMPONENTS;

export function AppRoutes() {
  return (
    <Routes>
      <Route path={PATHS.signin} element={<SignInPage />} />
      <Route path={PATHS.signup} element={<SignUpPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path={PATHS.jobs.slice(1)} element={<JobSearchPage />} />
        <Route path={`${PATHS.resumes.slice(1)}/:tab?`} element={<ResumesPage />} />
        <Route path={PATHS.applications.slice(1)} element={<ApplicationsPage />} />
        <Route path={PATHS.copilot.slice(1)} element={<CopilotPage />} />
        <Route path={PATHS.agents.slice(1)} element={<AgentsPage />} />
        <Route path={`${PATHS.mail.slice(1)}/:threadId?`} element={<MailPage />} />
        <Route path={`${PATHS.calendar.slice(1)}/:view?`} element={<CalendarPage />} />
        <Route path={PATHS.interviews.slice(1)} element={<InterviewPrepPage />} />
        <Route path={`${PATHS.reports.slice(1)}/:tab?`} element={<AnalyticsPage />} />
        <Route
          path={PATHS.aiUsage.slice(1)}
          element={
            <AdminRoute>
              <AiUsagePage />
            </AdminRoute>
          }
        />
        <Route
          path={PATHS.apiUsageMonitor.slice(1)}
          element={
            <AdminRoute>
              <ApiUsageMonitorPage />
            </AdminRoute>
          }
        />
        <Route path={PATHS.firebase.slice(1)} element={<FirebaseExplorerPage />} />
        <Route path={PATHS.bidManagement.slice(1)} element={<BidManagementPage />} />
        <Route path={PATHS.appsPlugins.slice(1)} element={<AppsPluginsPage />} />
        <Route path={`${PATHS.settings.slice(1)}/:tab?`} element={<SettingsPage />} />
        <Route path="*" element={<Navigate to={PATHS.dashboard} replace />} />
      </Route>
    </Routes>
  );
}

export default AppRoutes;
