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

export const BIG_INT_1E10 = BigInt.fromString('10000000000')

export const BIG_INT_1E9 = BigInt.fromString('1000000000')

export const BIG_INT_1E6 = BigInt.fromString('1000000')

export const LOCKUP_POOL_NUMBER = BigInt.fromI32(29)

export const NULL_CALL_RESULT_VALUE = '0x0000000000000000000000000000000000000000000000000000000000000001'

// EXCHANGE
export const FACTORY_ADDRESS = Address.fromString('0x1998E4b0F1F922367d8Ec20600ea2b86df55f34E')
export const VOLTAGE_START_BLOCK = BigInt.fromI32(15644529)

export const VOLT_TOKEN_ADDRESS = Address.fromString('0x34Ef2Cc892a88415e9f02b91BfA9c91fC0bE6bD4')

// MASTER CHEF
export const MASTER_CHEF_ADDRESS = Address.fromString('0x0000000000000000000000000000000000000000')
export const MASTER_CHEF_V2_ADDRESS = Address.fromString('0xc71E27C7e128d9CAEb2b8cA756647f7F199cF39e')
export const MASTER_CHEF_V3_ADDRESS = Address.fromString('0xE3e184a7b75D0Ae6E17B58F5283b91B4E0A2604F')
export const MASTER_CHEF_START_BLOCK = BigInt.fromI32(15887352)

// BAR
export const VOLT_BAR_ADDRESS = Address.fromString('0x97a6e78c9208c21afaDa67e7E61d7ad27688eFd1')

// MAKER
// export const JOE_MAKER_ADDRESS = Address.fromString('0x861726bfe27931a4e22a7277bde6cb8432b65856')
export const VOLT_MAKER_V2_ADDRESS = Address.fromString('0x0b72125d6c42Fb7a1ec2763500a8d8b758b0F3ef')

// PRICING
export const VOLTAGE_WFUSE_USDC_PAIR_ADDRESS = Address.fromString('0xc79983b0754ac688bf54939add59bdf75916fda2')
export const VOLT_FUSD_PAIR_ADDRESS = Address.fromString('0x4e6b54f8dee787b16d8cdba4f759342b19239c2c')

export const WFUSE_ADDRESS = Address.fromString('0x0be9e53fd7edac9f859882afdda116645287c629')
export const USDT_ADDRESS = Address.fromString('0xfadbbf8ce7d5b7041be672561bba99f79c532e10')
export const USDC_ADDRESS = Address.fromString('0x620fd5fa44be6af63715ef4e65ddfa0387ad13f5')
export const WBTC_ADDRESS = Address.fromString('0x33284f95ccb7b948d9d352e1439561cf83d8d00d')

export const TIME_ADDRESS = Address.fromString('0xb54f16fb19478766a268f172c9480f8da1a7c9c3')
export const APEX_ADDRESS = Address.fromString('0xd039c9079ca7f2a87d632a9c0d7cea0137bacfb5')
export const GB_ADDRESS = Address.fromString('0x90842eb834cfd2a1db0b1512b254a18e4d396215')
export const MYAK_ADDRESS = Address.fromString('0xddaaad7366b455aff8e7c82940c43ceb5829b604')

export const WFUSE_STABLE_PAIRS: string[] = [
    '0xca4df49cb6cfcab122b09f2c203820032005385e', // WFUSE-USDT
    '0xc79983b0754ac688bf54939add59bdf75916fda2', // WFUSE-USDC
    '0x91520fc2942fd52949514f159aa4927b8850178d', // WFUSE-BUSD
    '0x933a10d094592eb3f2a26bcb366472eba8868a66', // WFUSE-FUSD
]

export const WHITELIST: string[] = [
    '0x0be9e53fd7edac9f859882afdda116645287c629', // WFUSE
    '0xa722c13135930332eb3d749b2f0906559d2c5b99', // WETH
    '0x33284f95ccb7b948d9d352e1439561cf83d8d00d', // WBTC
    '0xfadbbf8ce7d5b7041be672561bba99f79c532e10', // USDT
    '0x620fd5fa44be6af63715ef4e65ddfa0387ad13f5', // USDC
    '0x249be57637d8b013ad64785404b24aebae9b098b', // FUSD
    '0x34ef2cc892a88415e9f02b91bfa9c91fc0be6bd4', // VOLT
]

// LOCKUP -- TO BE DEPRECATED?
export const LOCKUP_BLOCK_NUMBER = BigInt.fromI32(10959148)

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
export const MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('0')

// minimum liquidity for price to get tracked
export const MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('20000')

// MasterChefV2 precision
export const ACC_VOLT_PRECISION = BigInt.fromString('1000000000000')
