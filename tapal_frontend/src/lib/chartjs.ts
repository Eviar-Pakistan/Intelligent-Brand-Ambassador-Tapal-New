import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
)

export const chartTick = '#94a3b8'
export const chartGrid = '#f1f5f9'
export const chartGreen = '#dc2626'
export const chartGreenLight = '#f87171'
export const chartGold = '#fbbf24'
export const categoryColors = ['#f87171', '#dc2626', '#fbbf24']

export const defaultChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: {
        boxWidth: 12,
        font: { size: 11 },
        color: '#64748b',
      },
    },
    tooltip: {
      backgroundColor: '#fff',
      titleColor: '#0f172a',
      bodyColor: '#334155',
      borderColor: '#e2e8f0',
      borderWidth: 1,
      padding: 10,
      displayColors: true,
    },
  },
} as const
