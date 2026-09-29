import tapalLogo from '../assets/tapallogo.png'
import tapalSidebar from '../assets/tapalsidebar.png'
import tapalProduct from '../assets/tapalproduct.png'
import tapalBenefitsImg from '../assets/tapal benefits.png'
import tapaOurProductImg from '../assets/tapa our product.png'
import tapalOurProductImg from '../assets/tapal our product.png'
import tapaWhyChooseUsImg from '../assets/tapa why choose us.png'
import tapalPlayNowImg from '../assets/tapal play now.png'
import spinWheelImg from '../assets/spinner.png'

export type DiscoveryTile = {
  title: string
  image: string
}

export type ShopperSpinConfig = {
  wheel: string
  subtitle: string
  prizeLabels: [string, string, string]
  winAmount: string
  winDetail: string
  promoCode: string
}

export type BaGoalProduct = {
  src: string
  alt: string
  position?: string
  scale?: string
}

export type BrandConfig = {
  label: string
  productName: string
  tagline: string
  logo: string
  sidebar: string
  shopperProduct: string
  shopperHeadline: [string, string]
  shopperDiscoveryTitle: string
  shopperDiscoveryTiles: DiscoveryTile[]
  shopperPlayNow: string
  shopperSpin: ShopperSpinConfig
  baGoalProducts: BaGoalProduct[]
  loginEmail: string
  sidebarOverlay: string
}

export const brand: BrandConfig = {
  label: 'Tapal',
  productName: 'Tapal Tea',
  tagline: "Pakistan's Favourite Tea",
  logo: tapalLogo,
  sidebar: tapalSidebar,
  shopperProduct: tapalProduct,
  shopperHeadline: ['Truly Yours', 'Since 1947.'],
  shopperDiscoveryTitle: 'Discover Tapal Tea',
  shopperDiscoveryTiles: [
    { title: 'Health Benefits', image: tapalBenefitsImg },
    { title: 'Tapal Danedar', image: tapaOurProductImg },
    { title: 'Our Products', image: tapalOurProductImg },
    { title: 'Why Choose Us', image: tapaWhyChooseUsImg },
  ],
  shopperPlayNow: tapalPlayNowImg,
  shopperSpin: {
    wheel: spinWheelImg,
    subtitle: 'Exciting prizes for Tea Lovers!',
    prizeLabels: ['Rich Taste', 'Free Tea Sample', 'Rs. 100 Coupon'],
    winAmount: 'Rs. 100 OFF',
    winDetail: 'on your next Tapal Tea purchase',
    promoCode: 'TAPAL100',
  },
  baGoalProducts: [
    { src: tapaOurProductImg, alt: 'Tapal Danedar', scale: '1.1' },
    { src: tapalProduct, alt: 'Tapal Tea collection', position: '50% center', scale: '1.15' },
    { src: tapalOurProductImg, alt: 'Tapal product range', position: '35% center', scale: '1.25' },
  ],
  loginEmail: 'headoffice@tapaltea.com',
  sidebarOverlay: 'from-red-950/35 via-red-900/20 to-red-950/88',
}
