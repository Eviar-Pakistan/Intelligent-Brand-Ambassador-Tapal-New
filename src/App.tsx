import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { DemoProvider, RoleProvider } from './context/AppContext'
import { BrandProvider } from './context/BrandContext'
import { ScheduleProvider } from './context/ScheduleContext'
import { TrainingContentProvider } from './context/TrainingContentContext'
import { DesktopShell } from './components/AppShell'
import { BaShell, ShopperShell } from './components/RoleLayouts'
import { ScreenHub } from './pages/ScreenHub'
import { LoginPage } from './pages/LoginPage'
import { CommandCenterPage, OptimizationPage } from './pages/headOffice/CommandCenterPage'
import { BaPerformanceDashboardPage } from './pages/headOffice/BaPerformanceDashboardPage'
import { CampaignOverviewPage, CampaignsPage } from './pages/headOffice/CampaignPages'
import { AmbassadorProfilePage, AmbassadorsPage } from './pages/headOffice/AmbassadorPages'
import { TrainingManagerPage } from './pages/headOffice/TrainingManagerPage'
import { DeploymentPage, StoreDetailPage, StoresPage } from './pages/headOffice/StorePages'
import { CreateStorePage } from './pages/headOffice/StoreCreation'
import { SupervisorDetailPage, SupervisorsPage } from './pages/headOffice/SupervisorPages'
import {
  SupervisorBasPage,
  SupervisorGate,
  SupervisorHomePage,
  SupervisorStoresPage,
} from './pages/supervisor/SupervisorPortal'
import { ShopperStoreEntry } from './pages/shopper/ShopperStoreEntry'
import {
  ConsumersPage,
  LeaderboardPage,
  ReportPage,
  SettingsPage,
} from './pages/headOffice/IntelligencePages'
import { IncentivesPage } from './pages/headOffice/IncentivesPage'
import { ComplaintsPage } from './pages/headOffice/ComplaintPages'
import {
  AttendancePage,
  CoveragePage,
  ManagerDashboard,
} from './pages/manager/ManagerPages'
import {
  BaHomePage,
  BaPerformancePage,
  BaTrainingPage,
} from './pages/ba/BaPages'
import { BaDailySalesPage, BaOtherBrandsPage, BaStockReportPage } from './pages/ba/BaCheckoutPages'
import { BaComplaintPage } from './pages/ba/BaComplaintPage'
import { BaAccessPage } from './pages/ba/BaAccessPage'
import { ComplaintsProvider } from './context/ComplaintsContext'
import {
  ShopperAiPage,
  ShopperFeedbackPage,
  ShopperLandingPage,
  ShopperLearnPage,
  ShopperProductPage,
  ShopperRewardPage,
  ShopperSpinPage,
  ShopperSurveyPage,
  ShopperThanksPage,
} from './pages/shopper/ShopperPages'

const hoPages = (
  <>
    <Route index element={<Navigate to="dashboard" replace />} />
    <Route path="dashboard" element={<CommandCenterPage />} />
    <Route path="ba-performance" element={<BaPerformanceDashboardPage />} />
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
          <ScheduleProvider>
          <TrainingContentProvider>
          <BrowserRouter>
          <Routes>
            <Route path="/" element={<LoginPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/portal" element={<ScreenHub />} />

            {/* Head Office — desktop command center */}
            <Route path="/ho" element={<DesktopShell kind="headOffice" />}>
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
              <Route path="bas" element={<SupervisorBasPage />} />
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

            <Route path="/app/*" element={<Navigate to="/ho/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
          </BrowserRouter>
          </TrainingContentProvider>
          </ScheduleProvider>
          </ComplaintsProvider>
        </DemoProvider>
      </RoleProvider>
    </BrandProvider>
  )
}
