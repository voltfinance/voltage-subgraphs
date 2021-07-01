import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts'

// consts
export const ADDRESS_ZERO = Address.fromString('0x0000000000000000000000000000000000000000')

export const BIG_DECIMAL_1E6 = BigDecimal.fromString('1e6')

export const BIG_DECIMAL_1E12 = BigDecimal.fromString('1e12')

export const BIG_DECIMAL_1E18 = BigDecimal.fromString('1e18')

export const BIG_DECIMAL_ZERO = BigDecimal.fromString('0')

export const BIG_DECIMAL_ONE = BigDecimal.fromString('1')

export const BIG_INT_ONE = BigInt.fromI32(1)

export const BIG_INT_ONE_DAY_SECONDS = BigInt.fromI32(86400)

export const BIG_INT_ZERO = BigInt.fromI32(0)

export const BIG_INT_1E12 = BigInt.fromString('1000000000000')

export const LOCKUP_POOL_NUMBER = BigInt.fromI32(29)

export const NULL_CALL_RESULT_VALUE = '0x0000000000000000000000000000000000000000000000000000000000000001'

// EXCHANGE
export const FACTORY_ADDRESS = Address.fromString('0x9ad6c38be94206ca50bb0d90783181662f0cfa10')
export const TRADERJOE_START_BLOCK = BigInt.fromI32(2486000)

export const JOE_TOKEN_ADDRESS = Address.fromString('0x6e84a6216ea6dacc71ee8e6b0a5b7322eebc0fdd')

// MASTER CHEF
export const MASTER_CHEF_ADDRESS = Address.fromString('0x0000000000000000000000000000000000000000')
export const MASTER_CHEF_V2_ADDRESS = Address.fromString('0xd6a4f121ca35509af06a0be99093d08462f53052')
export const MASTER_CHEF_START_BLOCK = BigInt.fromI32(2486000)

// BAR
export const JOE_BAR_ADDRESS = Address.fromString('0x931b5dffebf156b3c295f0c50bbad494d35989ba')

// MAKER
export const JOE_MAKER_ADDRESS = Address.fromString('0xe8a191026e71c303b0f40f15be93403f7d529707')

// PRICING
export const TRADERJOE_WAVAX_USDT_PAIR_ADDRESS = Address.fromString('0xe4b9865c0866346ba3613ec122040a365637fb46')
export const JOE_USDT_PAIR_ADDRESS = Address.fromString('0x0000000000000000000000000000000000000000')

export const WAVAX_ADDRESS = Address.fromString('0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7')
export const USDT_ADDRESS = Address.fromString('0xde3a24028580884448a5397872046a019649b084')

export const WAVAX_STABLE_PAIRS: string[] = [
    '0xe4b9865c0866346ba3613ec122040a365637fb46', // WAVAX-USDT
    '0x43b9c8dec26c2d21146466caacabf94fdbeac473',  // WAVAX-DAI
]

export const WHITELIST: string[] = [
    '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7', // WAVAX
    '0xf20d962a6c8f70c731bd838a3a388d7d48fa6e15', // WETH
    '0x408d4cd0adb7cebd1f1a1c33a0ba2098e1295bab', // WBTC
    '0xde3a24028580884448a5397872046a019649b084', // USDT
    '0xba7deebbfc5fa1100fb055a87773e1e99cd3507a', // DAI
]

// LOCKUP -- TO BE DEPRECATED?
export const LOCKUP_BLOCK_NUMBER = BigInt.fromI32(10959148)

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
export const MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('0')

// minimum liquidity for price to get tracked
export const MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('5')

// MasterChefV2 precision
export const ACC_JOE_PRECISION = BigInt.fromString('1000000000000')
