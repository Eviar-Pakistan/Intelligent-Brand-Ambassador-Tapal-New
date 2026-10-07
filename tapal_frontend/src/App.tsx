import { lazy, Suspense } from 'react'
import { ServerSync } from './components/ServerSync'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { DemoProvider, RoleProvider } from './context/AppContext'
import { BrandProvider } from './context/BrandContext'
import { ScheduleProvider } from './context/ScheduleContext'
import { TrainingContentProvider } from './context/TrainingContentContext'
import { DesktopShell } from './components/AppShell'
import { BaShell, ShopperShell } from './components/RoleLayouts'
import { ScreenHub } from './pages/ScreenHub'
import { HeadOfficeGate, LoginPage } from './pages/LoginPage'
const BaDailyReportsPage = lazy(() => import('./pages/headOffice/CommandCenterPage').then((m) => ({ default: m.BaDailyReportsPage })))
const OptimizationPage = lazy(() => import('./pages/headOffice/CommandCenterPage').then((m) => ({ default: m.OptimizationPage })))
const BaPerformanceDashboardPage = lazy(() => import('./pages/headOffice/BaPerformanceDashboardPage').then((m) => ({ default: m.BaPerformanceDashboardPage })))
const CampaignOverviewPage = lazy(() => import('./pages/headOffice/CampaignPages').then((m) => ({ default: m.CampaignOverviewPage })))
const CampaignsPage = lazy(() => import('./pages/headOffice/CampaignPages').then((m) => ({ default: m.CampaignsPage })))
const BaAttendancePage = lazy(() => import('./pages/headOffice/BaAttendancePage').then((m) => ({ default: m.BaAttendancePage })))
const StockBoardPage = lazy(() => import('./pages/headOffice/StockBoardPage').then((m) => ({ default: m.StockBoardPage })))
const AmbassadorProfilePage = lazy(() => import('./pages/headOffice/AmbassadorPages').then((m) => ({ default: m.AmbassadorProfilePage })))
const AmbassadorsPage = lazy(() => import('./pages/headOffice/AmbassadorPages').then((m) => ({ default: m.AmbassadorsPage })))
const TrainingManagerPage = lazy(() => import('./pages/headOffice/TrainingManagerPage').then((m) => ({ default: m.TrainingManagerPage })))
const DeploymentPage = lazy(() => import('./pages/headOffice/StorePages').then((m) => ({ default: m.DeploymentPage })))
const StoreDetailPage = lazy(() => import('./pages/headOffice/StorePages').then((m) => ({ default: m.StoreDetailPage })))
const StoresPage = lazy(() => import('./pages/headOffice/StorePages').then((m) => ({ default: m.StoresPage })))
const CreateStorePage = lazy(() => import('./pages/headOffice/StoreCreation').then((m) => ({ default: m.CreateStorePage })))
const SupervisorDetailPage = lazy(() => import('./pages/headOffice/SupervisorPages').then((m) => ({ default: m.SupervisorDetailPage })))
const SupervisorsPage = lazy(() => import('./pages/headOffice/SupervisorPages').then((m) => ({ default: m.SupervisorsPage })))
const SupervisorPortal = () => import('./pages/supervisor/SupervisorPortal')
const SupervisorAttendancePage = lazy(() => SupervisorPortal().then((m) => ({ default: m.SupervisorAttendancePage })))
const SupervisorBasPage = lazy(() => SupervisorPortal().then((m) => ({ default: m.SupervisorBasPage })))
const SupervisorTargetsPage = lazy(() => SupervisorPortal().then((m) => ({ default: m.SupervisorTargetsPage })))
const SupervisorGate = lazy(() => SupervisorPortal().then((m) => ({ default: m.SupervisorGate })))
const SupervisorHomePage = lazy(() => SupervisorPortal().then((m) => ({ default: m.SupervisorHomePage })))
const SupervisorSalesPage = lazy(() => SupervisorPortal().then((m) => ({ default: m.SupervisorSalesPage })))
const SupervisorStoresPage = lazy(() => SupervisorPortal().then((m) => ({ default: m.SupervisorStoresPage })))
const SupervisorSubmissionsPage = lazy(() => SupervisorPortal().then((m) => ({ default: m.SupervisorSubmissionsPage })))
const SupervisorJourneyPage = lazy(() => import('./pages/supervisor/SupervisorJourney').then((m) => ({ default: m.SupervisorJourneyPage })))
import { RootEntry, ShopperStoreEntry } from './pages/shopper/ShopperStoreEntry'
const InterceptionsPage = lazy(() => import('./pages/headOffice/InterceptionsPage').then((m) => ({ default: m.InterceptionsPage })))
const ConsumersPage = lazy(() => import('./pages/headOffice/IntelligencePages').then((m) => ({ default: m.ConsumersPage })))
const LeaderboardPage = lazy(() => import('./pages/headOffice/IntelligencePages').then((m) => ({ default: m.LeaderboardPage })))
const ReportPage = lazy(() => import('./pages/headOffice/IntelligencePages').then((m) => ({ default: m.ReportPage })))
const SettingsPage = lazy(() => import('./pages/headOffice/IntelligencePages').then((m) => ({ default: m.SettingsPage })))
const IncentivesPage = lazy(() => import('./pages/headOffice/IncentivesPage').then((m) => ({ default: m.IncentivesPage })))
const ComplaintsPage = lazy(() => import('./pages/headOffice/ComplaintPages').then((m) => ({ default: m.ComplaintsPage })))
const AttendancePage = lazy(() => import('./pages/manager/ManagerPages').then((m) => ({ default: m.AttendancePage })))
const CoveragePage = lazy(() => import('./pages/manager/ManagerPages').then((m) => ({ default: m.CoveragePage })))
const ManagerDashboard = lazy(() => import('./pages/manager/ManagerPages').then((m) => ({ default: m.ManagerDashboard })))
const BaHomePage = lazy(() => import('./pages/ba/BaPages').then((m) => ({ default: m.BaHomePage })))
const BaPerformancePage = lazy(() => import('./pages/ba/BaPages').then((m) => ({ default: m.BaPerformancePage })))
const BaTrainingPage = lazy(() => import('./pages/ba/BaPages').then((m) => ({ default: m.BaTrainingPage })))
const BaDailySalesPage = lazy(() => import('./pages/ba/BaCheckoutPages').then((m) => ({ default: m.BaDailySalesPage })))
const BaOtherBrandsPage = lazy(() => import('./pages/ba/BaCheckoutPages').then((m) => ({ default: m.BaOtherBrandsPage })))
const BaStockReportPage = lazy(() => import('./pages/ba/BaCheckoutPages').then((m) => ({ default: m.BaStockReportPage })))
const BaComplaintPage = lazy(() => import('./pages/ba/BaComplaintPage').then((m) => ({ default: m.BaComplaintPage })))
const BaInterceptionPage = lazy(() => import('./pages/ba/BaInterceptionPage').then((m) => ({ default: m.BaInterceptionPage })))
const BaAccessPage = lazy(() => import('./pages/ba/BaAccessPage').then((m) => ({ default: m.BaAccessPage })))
import { ComplaintsProvider } from './context/ComplaintsContext'
const ShopperAiPage = lazy(() => import('./pages/shopper/ShopperPages').then((m) => ({ default: m.ShopperAiPage })))
const ShopperFeedbackPage = lazy(() => import('./pages/shopper/ShopperPages').then((m) => ({ default: m.ShopperFeedbackPage })))
const ShopperLandingPage = lazy(() => import('./pages/shopper/ShopperPages').then((m) => ({ default: m.ShopperLandingPage })))
const ShopperLearnPage = lazy(() => import('./pages/shopper/ShopperPages').then((m) => ({ default: m.ShopperLearnPage })))
const ShopperProductPage = lazy(() => import('./pages/shopper/ShopperPages').then((m) => ({ default: m.ShopperProductPage })))
const ShopperRewardPage = lazy(() => import('./pages/shopper/ShopperPages').then((m) => ({ default: m.ShopperRewardPage })))
const ShopperSpinPage = lazy(() => import('./pages/shopper/ShopperPages').then((m) => ({ default: m.ShopperSpinPage })))
const ShopperSurveyPage = lazy(() => import('./pages/shopper/ShopperPages').then((m) => ({ default: m.ShopperSurveyPage })))
const ShopperThanksPage = lazy(() => import('./pages/shopper/ShopperPages').then((m) => ({ default: m.ShopperThanksPage })))

const hoPages = (
  <>
    {/* The Dashboard (BA performance) is the landing page; the old Campaign Metrics page is not shown. */}
    <Route index element={<Navigate to="ba-performance" replace />} />
    <Route path="dashboard" element={<Navigate to="../ba-performance" replace />} />
    <Route path="ba-performance" element={<BaPerformanceDashboardPage />} />
    <Route path="daily-reports" element={<BaDailyReportsPage />} />
    <Route path="stock" element={<StockBoardPage />} />
    <Route path="attendance" element={<BaAttendancePage />} />
    <Route path="interceptions" element={<InterceptionsPage />} />
    <Route path="ambassadors" element={<AmbassadorsPage />} />
    <Route path="ambassadors/training" element={<TrainingManagerPage />} />
    <Route path="ambassadors/:id" element={<AmbassadorProfilePage />} />
    <Route path="stores" element={<StoresPage />} />
    <Route path="stores/new" element={<CreateStorePage />} />
    <Route path="stores/:id" element={<StoreDetailPage />} />
    <Route path="deployment" element={<DeploymentPage />} />
    <Route path="supervisors" element={<SupervisorsPage />} />
    <Route path="supervisors/:id" element={<SupervisorDetailPage />} />
    <Route path="consumers" element={<ConsumersPage />} />
    <Route path="optimization" element={<OptimizationPage />} />
    <Route path="leaderboard" element={<LeaderboardPage />} />
    <Route path="incentives" element={<IncentivesPage />} />
    <Route path="complaints" element={<ComplaintsPage />} />
    <Route path="reports" element={<ReportPage />} />
  </>
)

export default function App() {
  return (
    <BrandProvider>
      <RoleProvider>
        <DemoProvider>
          <ComplaintsProvider>
          <BrowserRouter>
          <TrainingContentProvider>
          <ScheduleProvider>
          <ServerSync />
          <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">Loading page…</div>}>
          <Routes>
            <Route path="/" element={<RootEntry />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/supervisor/login" element={<LoginPage initialTab="supervisor" />} />
            <Route path="/portal" element={<ScreenHub />} />

            {/* Head Office — desktop command center */}
            <Route path="/ho" element={<HeadOfficeGate />}>
              {hoPages}
            </Route>

            {/* Administrator — desktop config */}
            <Route path="/admin" element={<DesktopShell kind="admin" />}>
              <Route index element={<Navigate to="settings" replace />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="ambassadors" element={<AmbassadorsPage />} />
              <Route path="ambassadors/training" element={<TrainingManagerPage />} />
              <Route path="ambassadors/:id" element={<AmbassadorProfilePage />} />
              <Route path="stores" element={<StoresPage />} />
              <Route path="stores/new" element={<CreateStorePage />} />
              <Route path="stores/:id" element={<StoreDetailPage />} />
              <Route path="supervisors" element={<SupervisorsPage />} />
              <Route path="supervisors/:id" element={<SupervisorDetailPage />} />
              <Route path="campaigns" element={<CampaignsPage />} />
              <Route path="campaigns/:id" element={<CampaignOverviewPage />} />
            </Route>

            {/* Store Manager — desktop field ops */}
            <Route path="/manager" element={<DesktopShell kind="storeManager" />}>
              <Route index element={<ManagerDashboard />} />
              <Route path="attendance" element={<AttendancePage />} />
              <Route path="coverage" element={<CoveragePage />} />
              <Route path="deployment" element={<DeploymentPage />} />
              <Route path="stores" element={<StoresPage />} />
              <Route path="stores/new" element={<CreateStorePage />} />
              <Route path="stores/:id" element={<StoreDetailPage />} />
            </Route>

            {/* Supervisor — desktop oversight of their assigned stores */}
            <Route path="/supervisor" element={<SupervisorGate />}>
              <Route index element={<SupervisorHomePage />} />
              <Route path="stores" element={<SupervisorStoresPage />} />
              <Route path="journey" element={<SupervisorJourneyPage />} />
              <Route path="attendance" element={<SupervisorAttendancePage />} />
              <Route path="targets" element={<SupervisorTargetsPage />} />
              <Route path="bas" element={<SupervisorBasPage />} />
              <Route path="submissions" element={<SupervisorSubmissionsPage />} />
              <Route path="stock" element={<StockBoardPage />} />
              <Route path="sales" element={<SupervisorSalesPage />} />
            </Route>

            {/* Personal BA link — signs that ambassador in, then opens their app */}
            <Route path="/ba/open/:token" element={<BaAccessPage />} />

            {/* Brand Ambassador — full-screen mobile app */}
            <Route path="/ba" element={<BaShell />}>
              <Route index element={<Navigate to="home" replace />} />
              <Route path="home" element={<BaHomePage />} />
              <Route path="training" element={<BaTrainingPage />} />
              <Route path="performance" element={<BaPerformancePage />} />
              <Route path="complaint" element={<BaComplaintPage />} />
              <Route path="interception" element={<BaInterceptionPage />} />
              <Route path="daily-sales" element={<BaDailySalesPage />} />
              <Route path="stock-report" element={<BaStockReportPage />} />
              <Route path="other-brands" element={<BaOtherBrandsPage />} />
            </Route>

            {/* Shopper — full-screen mobile web */}
            <Route path="/shopper" element={<ShopperShell />}>
              <Route index element={<ShopperLandingPage />} />
              <Route path="product" element={<ShopperProductPage />} />
              <Route path="learn" element={<ShopperLearnPage />} />
              <Route path="spin" element={<ShopperSpinPage />} />
              <Route path="ai" element={<ShopperAiPage />} />
              <Route path="survey" element={<ShopperSurveyPage />} />
              <Route path="reward" element={<ShopperRewardPage />} />
              <Route path="feedback" element={<ShopperFeedbackPage />} />
              <Route path="thanks" element={<ShopperThanksPage />} />
              <Route path=":storeSlug" element={<ShopperStoreEntry />} />
            </Route>

            <Route path="/app/*" element={<Navigate to="/ho/ba-performance" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
          </Suspense>
          </ScheduleProvider>
          </TrainingContentProvider>
          </BrowserRouter>
          </ComplaintsProvider>
        </DemoProvider>
      </RoleProvider>
    </BrandProvider>
  )
}
