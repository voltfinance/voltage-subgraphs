import {
  Add,
  Set,
  Deposit,
  EmergencyWithdraw,
  MasterChefVoltV2 as MasterChefV2Contract,
  OwnershipTransferred,
  UpdateEmissionRate,
  Withdraw,
} from '../generated/MasterChefVoltV2/MasterChefVoltV2'
import { Address, BigDecimal, BigInt, dataSource, ethereum, log } from '@graphprotocol/graph-ts'
import {
  BIG_DECIMAL_1E12,
  BIG_DECIMAL_1E18,
  BIG_DECIMAL_ZERO,
  BIG_INT_ONE,
  BIG_INT_ONE_DAY_SECONDS,
  BIG_INT_ZERO,
  MASTER_CHEF_V2_ADDRESS,
  MASTER_CHEF_START_BLOCK,
  ADDRESS_ZERO,
} from 'const'
import { History, MasterChef, Pool, PoolHistory, Rewarder, User } from '../generated/schema'
import { getVoltPrice, getUSDRate } from 'pricing'

import { ERC20 as ERC20Contract } from '../generated/MasterChefVoltV2/ERC20'
import { Pair as PairContract } from '../generated/MasterChefVoltV2/Pair'
import { Rewarder as RewarderContract } from '../generated/MasterChefVoltV2/Rewarder'

/*
 * Event handler, called after masterchef adds new LP pool
 * We get the pool and add this to graph
 */
export function add(event: Add): void {
  const masterChefV2 = getMasterChef(event.block)
  const allocPoint = event.params.allocPoint
  // get getPool to create pool
  getPool(masterChefV2.poolCount, event.block)
  log.info('[add] poolcount: {}, allocPoint: {}', [masterChefV2.poolCount.toString(), allocPoint.toString()])
  // Update MasterChef.
  masterChefV2.totalAllocPoint = masterChefV2.totalAllocPoint.plus(allocPoint)
  masterChefV2.poolCount = masterChefV2.poolCount.plus(BIG_INT_ONE)
  masterChefV2.save()
}

/*
 * Event handler, called after masterchef sets liquidity to LP pool
 * We get the pool and update to graph
 */
export function set(event: Set): void {
  const masterChefV2 = getMasterChef(event.block)
  const pool = getPool(event.params.pid, event.block)
  const allocPoint = event.params.allocPoint
  // Update masterchef
  masterChefV2.totalAllocPoint = masterChefV2.totalAllocPoint.plus(allocPoint.minus(pool.allocPoint))
  masterChefV2.save()
  // Update pool
  pool.allocPoint = allocPoint
  if (event.params.overwrite) {
    const rewarder = getRewarder(event.params.rewarder, event.block)
    pool.rewarder = rewarder ? rewarder.id : null
  }
  log.info('[set] pool: {}, alloc: {}, rewarder: {}', [
    pool.id,
    allocPoint.toString(),
    event.params.rewarder.toString(),
  ])
  pool.save()
}

/*
 * Event handler, called after user deposits liquidity
 * We update pool, histories and user jlp balances
 *
 * event params: {user, pid, amount}
 */
export function deposit(event: Deposit): void {
  const amount = event.params.amount.divDecimal(BIG_DECIMAL_1E18)
  const masterChefV2Contract = MasterChefV2Contract.bind(MASTER_CHEF_V2_ADDRESS)
  // update pool
  const poolInfoResult = masterChefV2Contract.try_poolInfo(event.params.pid)
  if (poolInfoResult.reverted) {
    log.info('[deposit] poolInfo reverted', [])
    return
  }
  const poolInfo = poolInfoResult.value
  const pool = getPool(event.params.pid, event.block)
  const poolHistory = getPoolHistory(pool, event.block)
  const pairContract = PairContract.bind(poolInfo.value0)
  pool.balance = pairContract.balanceOf(MASTER_CHEF_V2_ADDRESS)
  pool.lastRewardTimestamp = poolInfo.value2
  pool.accVoltPerShare = poolInfo.value3
  const poolDays = event.block.timestamp.minus(pool.updatedAt).divDecimal(BigDecimal.fromString('86400'))
  pool.flpAge = pool.flpAge.plus(poolDays.times(pool.flpBalance))
  pool.flpDeposited = pool.flpDeposited.plus(amount)
  pool.flpBalance = pool.flpBalance.plus(amount)
  pool.updatedAt = event.block.timestamp
  // get user
  const userInfo = masterChefV2Contract.userInfo(event.params.pid, event.params.user)
  const user = getUser(event.params.pid, event.params.user, event.block)
  // If not currently in pool and depositing JLP
  if (!user.pool && event.params.amount.gt(BIG_INT_ZERO)) {
    user.pool = pool.id
    pool.userCount = pool.userCount.plus(BIG_INT_ONE)
    log.info('[deposit] user {} entered pool {}', [user.id, pool.id])
  }
  // Calculate JOE being paid out
  // NOTE: currently using pricing via JOE/USDT while exchange subgraph is based on JOE/AVAX
  // this results in some small discrepancy in JOE price, and therefore joeHarvestedUSD
  // we live with this data point has no impact to front end experience, only analytics
  if (event.block.number.gt(MASTER_CHEF_START_BLOCK) && user.amount.gt(BIG_INT_ZERO)) {
    const pending = user.amount
      .toBigDecimal()
      .times(pool.accVoltPerShare.toBigDecimal())
      .div(BIG_DECIMAL_1E12)
      .minus(user.rewardDebt.toBigDecimal())
      .div(BIG_DECIMAL_1E18)
    log.info('[deposit] pending: {}', [pending.toString()])
    if (pending.gt(BIG_DECIMAL_ZERO)) {
      const joeHarvestedUSD = pending.times(getVoltPrice(event.block))
      log.info('[deposit] joeHarvestedUSD: {}', [joeHarvestedUSD.toString()])
      user.voltHarvested = user.voltHarvested.plus(pending)
      user.voltHarvestedUSD = user.voltHarvestedUSD.plus(joeHarvestedUSD)
      pool.voltHarvested = pool.voltHarvested.plus(pending)
      pool.voltHarvestedUSD = pool.voltHarvestedUSD.plus(joeHarvestedUSD)
      poolHistory.voltHarvested = pool.voltHarvested
      poolHistory.voltHarvestedUSD = pool.voltHarvestedUSD
    }
  }
  // update user
  user.amount = userInfo.value0
  user.rewardDebt = userInfo.value1
  if (event.params.amount.gt(BIG_INT_ZERO)) {
    const reservesResult = pairContract.try_getReserves()
    if (!reservesResult.reverted) {
      const totalSupply = pairContract.totalSupply()
      const share = amount.div(totalSupply.toBigDecimal())
      const token0Amount = reservesResult.value.value0.toBigDecimal().times(share)
      const token1Amount = reservesResult.value.value1.toBigDecimal().times(share)
      const token0PriceUSD = getUSDRate(pairContract.token0(), event.block)
      const token1PriceUSD = getUSDRate(pairContract.token1(), event.block)
      const token0USD = token0Amount.times(token0PriceUSD)
      const token1USD = token1Amount.times(token1PriceUSD)
      const entryUSD = token0USD.plus(token1USD)
      user.entryUSD = user.entryUSD.plus(entryUSD)
      pool.entryUSD = pool.entryUSD.plus(entryUSD)
      poolHistory.entryUSD = pool.entryUSD
    } else {
      log.info("Deposit couldn't get reserves for pair {}", [poolInfo.value0.toHex()])
    }
  }
  user.save()
  pool.save()
  // update masterchef
  const masterChefV2 = getMasterChef(event.block)
  const masterChefV2Days = event.block.timestamp
    .minus(masterChefV2.updatedAt)
    .divDecimal(BigDecimal.fromString('86400'))
  masterChefV2.flpAge = masterChefV2.flpAge.plus(masterChefV2Days.times(masterChefV2.flpBalance))
  masterChefV2.flpDeposited = masterChefV2.flpDeposited.plus(amount)
  masterChefV2.flpBalance = masterChefV2.flpBalance.plus(amount)
  masterChefV2.updatedAt = event.block.timestamp
  masterChefV2.save()
  // update masterchef history
  const history = getHistory(MASTER_CHEF_V2_ADDRESS.toHex(), event.block)
  history.flpAge = masterChefV2.flpAge
  history.flpBalance = masterChefV2.flpBalance
  history.flpDeposited = history.flpDeposited.plus(amount)
  history.save()
  // update pool history
  poolHistory.flpAge = pool.flpAge
  poolHistory.flpBalance = pool.balance.divDecimal(BIG_DECIMAL_1E18)
  poolHistory.flpDeposited = poolHistory.flpDeposited.plus(amount)
  poolHistory.userCount = pool.userCount
  poolHistory.save()
}

/*
 * Event handler, called after user withdraws liquidity
 * We update pool, histories and user jlp balances
 *
 * event params: {user, pid, amount}
 */
export function withdraw(event: Withdraw): void {
  const amount = event.params.amount.divDecimal(BIG_DECIMAL_1E18)
  const masterChefV2Contract = MasterChefV2Contract.bind(MASTER_CHEF_V2_ADDRESS)
  // update pool
  const poolInfoResult = masterChefV2Contract.try_poolInfo(event.params.pid)
  if (poolInfoResult.reverted) {
    log.info('[withdraw] poolInfo reverted', [])
    return
  }
  const poolInfo = poolInfoResult.value
  const pool = getPool(event.params.pid, event.block)
  const poolHistory = getPoolHistory(pool, event.block)
  const pairContract = PairContract.bind(poolInfo.value0)
  pool.balance = pairContract.balanceOf(MASTER_CHEF_V2_ADDRESS)
  pool.lastRewardTimestamp = poolInfo.value2
  pool.accVoltPerShare = poolInfo.value3
  const poolDays = event.block.timestamp.minus(pool.updatedAt).divDecimal(BigDecimal.fromString('86400'))
  const poolAge = pool.flpAge.plus(poolDays.times(pool.flpBalance))
  const poolAgeRemoved = poolAge.div(pool.flpBalance).times(amount)
  pool.flpAge = poolAge.minus(poolAgeRemoved)
  pool.flpAgeRemoved = pool.flpAgeRemoved.plus(poolAgeRemoved)
  pool.flpWithdrawn = pool.flpWithdrawn.plus(amount)
  pool.flpBalance = pool.flpBalance.minus(amount)
  pool.updatedAt = event.block.timestamp
  // get user
  const user = getUser(event.params.pid, event.params.user, event.block)
  const userInfo = masterChefV2Contract.userInfo(event.params.pid, event.params.user)
  // calculate JOE owed
  if (event.block.number.gt(MASTER_CHEF_START_BLOCK) && user.amount.gt(BIG_INT_ZERO)) {
    const pending = user.amount
      .toBigDecimal()
      .times(pool.accVoltPerShare.toBigDecimal())
      .div(BIG_DECIMAL_1E12)
      .minus(user.rewardDebt.toBigDecimal())
      .div(BIG_DECIMAL_1E18)
    log.info('[withdraw] pending: {}', [pending.toString()])
    if (pending.gt(BIG_DECIMAL_ZERO)) {
      const voltHarvestedUSD = pending.times(getVoltPrice(event.block))
      log.info('[withdraw] harvested: {}', [voltHarvestedUSD.toString()])
      user.voltHarvested = user.voltHarvested.plus(pending)
      user.voltHarvestedUSD = user.voltHarvestedUSD.plus(voltHarvestedUSD)
      pool.voltHarvested = pool.voltHarvested.plus(pending)
      pool.voltHarvestedUSD = pool.voltHarvestedUSD.plus(voltHarvestedUSD)
      poolHistory.voltHarvested = pool.voltHarvested
      poolHistory.voltHarvestedUSD = pool.voltHarvestedUSD
    }
  }
  // update user
  user.amount = userInfo.value0
  user.rewardDebt = userInfo.value1
  if (event.params.amount.gt(BIG_INT_ZERO)) {
    const reservesResult = pairContract.try_getReserves()
    if (!reservesResult.reverted) {
      const totalSupply = pairContract.totalSupply()
      const share = amount.div(totalSupply.toBigDecimal())
      const token0Amount = reservesResult.value.value0.toBigDecimal().times(share)
      const token1Amount = reservesResult.value.value1.toBigDecimal().times(share)
      const token0PriceUSD = getUSDRate(pairContract.token0(), event.block)
      const token1PriceUSD = getUSDRate(pairContract.token1(), event.block)
      const token0USD = token0Amount.times(token0PriceUSD)
      const token1USD = token1Amount.times(token1PriceUSD)
      const exitUSD = token0USD.plus(token1USD)
      pool.exitUSD = pool.exitUSD.plus(exitUSD)
      poolHistory.exitUSD = pool.exitUSD
      user.exitUSD = user.exitUSD.plus(exitUSD)
    } else {
      log.info("Withdraw couldn't get reserves for pair {}", [poolInfo.value0.toHex()])
    }
  }
  // If JLP amount equals zero, remove from pool and reduce userCount
  if (user.amount.equals(BIG_INT_ZERO)) {
    user.pool = null
    pool.userCount = pool.userCount.minus(BIG_INT_ONE)
  }
  user.save()
  pool.save()
  // update masterchef
  const masterChefV2 = getMasterChef(event.block)
  const days = event.block.timestamp.minus(masterChefV2.updatedAt).divDecimal(BigDecimal.fromString('86400'))
  const flpAge = masterChefV2.flpAge.plus(days.times(masterChefV2.flpBalance))
  const flpAgeRemoved = flpAge.div(masterChefV2.flpBalance).times(amount)
  masterChefV2.flpAge = flpAge.minus(flpAgeRemoved)
  masterChefV2.flpAgeRemoved = masterChefV2.flpAgeRemoved.plus(flpAgeRemoved)
  masterChefV2.flpWithdrawn = masterChefV2.flpWithdrawn.plus(amount)
  masterChefV2.flpBalance = masterChefV2.flpBalance.minus(amount)
  masterChefV2.updatedAt = event.block.timestamp
  masterChefV2.save()
  // update masterchef history
  const history = getHistory(MASTER_CHEF_V2_ADDRESS.toHex(), event.block)
  history.flpAge = masterChefV2.flpAge
  history.flpAgeRemoved = history.flpAgeRemoved.plus(flpAgeRemoved)
  history.flpBalance = masterChefV2.flpBalance
  history.flpWithdrawn = history.flpWithdrawn.plus(amount)
  history.save()
  // update pool history
  poolHistory.flpAge = pool.flpAge
  poolHistory.flpAgeRemoved = poolHistory.flpAgeRemoved.plus(flpAgeRemoved)
  poolHistory.flpBalance = pool.balance.divDecimal(BIG_DECIMAL_1E18)
  poolHistory.flpWithdrawn = poolHistory.flpWithdrawn.plus(amount)
  poolHistory.userCount = pool.userCount
  poolHistory.save()
}

/*
 * Event handler for emergencyWithdraw
 *
 */
export function emergencyWithdraw(event: EmergencyWithdraw): void {
  log.info('User {} emergancy withdrawal of {} from pool #{}', [
    event.params.user.toHex(),
    event.params.amount.toString(),
    event.params.pid.toString(),
  ])
  const pool = getPool(event.params.pid, event.block)
  const pairContract = PairContract.bind(pool.pair as Address)
  pool.balance = pairContract.balanceOf(MASTER_CHEF_V2_ADDRESS)
  pool.save()
  // Update user
  const user = getUser(event.params.pid, event.params.user, event.block)
  user.amount = BIG_INT_ZERO
  user.rewardDebt = BIG_INT_ZERO
  user.save()
}

/*
 * Event handler for ownershipTransferred
 *
 */
export function ownershipTransferred(event: OwnershipTransferred): void {
  // log.info('Ownership transfered from previous owner: {} to new owner: {}', [
  //   event.params.previousOwner.toHex(),
  //   event.params.newOwner.toHex(),
  // ])
}

/*
 * Event handler for updateEmissionRate
 */
export function updateEmissionRate(event: UpdateEmissionRate): void {
  const newVoltPerSec = event.params._voltPerSec
  const masterChefV2 = getMasterChef(event.block)
  masterChefV2.voltPerSec = newVoltPerSec
  masterChefV2.save()
}

// UTILITY FUNCTIONS

/*
 * get or create masterchef
 */
function getMasterChef(block: ethereum.Block): MasterChef {
  let masterChefV2 = MasterChef.load(MASTER_CHEF_V2_ADDRESS.toHex())

  if (masterChefV2 === null) {
    log.info('[getMasterChef] creating new master chef', [])

    const contract = MasterChefV2Contract.bind(MASTER_CHEF_V2_ADDRESS)
    masterChefV2 = new MasterChef(MASTER_CHEF_V2_ADDRESS.toHex())
    masterChefV2.devAddr = contract.devAddr()
    masterChefV2.treasuryAddr = contract.treasuryAddr()
    masterChefV2.investorAddr = contract.investorAddr()
    masterChefV2.owner = contract.owner()
    // poolInfo ...
    masterChefV2.startTimestamp = contract.startTimestamp()
    masterChefV2.volt = contract.volt()
    masterChefV2.voltPerSec = contract.voltPerSec()
    masterChefV2.totalAllocPoint = BIG_INT_ZERO
    // userInfo ...
    masterChefV2.poolCount = BIG_INT_ZERO

    masterChefV2.flpBalance = BIG_DECIMAL_ZERO
    masterChefV2.flpAge = BIG_DECIMAL_ZERO
    masterChefV2.flpAgeRemoved = BIG_DECIMAL_ZERO
    masterChefV2.flpDeposited = BIG_DECIMAL_ZERO
    masterChefV2.flpWithdrawn = BIG_DECIMAL_ZERO

    masterChefV2.updatedAt = block.timestamp

    masterChefV2.save()
  }

  return masterChefV2 as MasterChef
}

/*
 * get or create pool
 */
export function getPool(id: BigInt, block: ethereum.Block): Pool {
  let pool = Pool.load(id.toString())
  const masterChefV2 = getMasterChef(block)
  const masterChefV2Contract = MasterChefV2Contract.bind(MASTER_CHEF_V2_ADDRESS)
  const poolInfoResult = masterChefV2Contract.try_poolInfo(id)
  if (poolInfoResult.reverted) {
    log.info('[masterchef getPool] poolInfo reverted', [])
    return null
  }
  const poolInfo = poolInfoResult.value

  if (pool === null) {
    // Create new pool.
    pool = new Pool(id.toString())
    log.info('[getPool] creating new pool, {}', [id.toString()])

    // Set relation
    pool.owner = masterChefV2.id
    pool.pair = poolInfo.value0
    pool.allocPoint = poolInfo.value1
    pool.lastRewardTimestamp = poolInfo.value2
    pool.accVoltPerShare = poolInfo.value3
    pool.rewarder = null
    // Total supply of LP tokens
    pool.balance = BIG_INT_ZERO
    pool.userCount = BIG_INT_ZERO

    pool.flpBalance = BIG_DECIMAL_ZERO
    pool.flpAge = BIG_DECIMAL_ZERO
    pool.flpAgeRemoved = BIG_DECIMAL_ZERO
    pool.flpDeposited = BIG_DECIMAL_ZERO
    pool.flpWithdrawn = BIG_DECIMAL_ZERO

    pool.timestamp = block.timestamp
    pool.block = block.number

    pool.updatedAt = block.timestamp
    pool.entryUSD = BIG_DECIMAL_ZERO
    pool.exitUSD = BIG_DECIMAL_ZERO
    pool.voltHarvested = BIG_DECIMAL_ZERO
    pool.voltHarvestedUSD = BIG_DECIMAL_ZERO
    pool.save()
  }
  // Update rewarder again outside of scope as it may be updated anytime during lifecycle
  // of a pool.
  const rewarder = getRewarder(poolInfo.value4, block)
  pool.rewarder = rewarder ? rewarder.id : null
  pool.save()

  return pool as Pool
}

function getRewarder(rewarderAddress: Address, block: ethereum.Block): Rewarder {
  if (rewarderAddress == ADDRESS_ZERO || rewarderAddress == null) {
    return null
  }

  let rewarder = Rewarder.load(rewarderAddress.toHex())
  if (rewarder == null) {
    log.info('[getRewarder] Creating new rewarder {}', [rewarderAddress.toHexString()])
    rewarder = new Rewarder(rewarderAddress.toHex())
  }
  const rewarderContract = RewarderContract.bind(rewarderAddress)
  const tokenAddressCall = rewarderContract.try_rewardToken()
  const tokenAddress = tokenAddressCall.reverted ? ADDRESS_ZERO : tokenAddressCall.value
  rewarder.rewardToken = tokenAddress

  const tokenPerSecCall = rewarderContract.try_tokenPerSec()
  rewarder.tokenPerSec = tokenPerSecCall.reverted ? BIG_INT_ZERO : tokenPerSecCall.value

  const tokenContract = ERC20Contract.bind(tokenAddress)
  const tokenNameCall = tokenContract.try_name()
  rewarder.name = tokenNameCall.reverted ? '' : tokenNameCall.value

  const tokenSymbolCall = tokenContract.try_symbol()
  rewarder.symbol = tokenSymbolCall.reverted ? '' : tokenSymbolCall.value

  const tokenDecimalsCall = tokenContract.try_decimals()
  rewarder.decimals = tokenDecimalsCall.reverted ? 0 : tokenDecimalsCall.value

  const currentBalanceCall = tokenContract.try_balanceOf(rewarderAddress)
  const currentBalance = currentBalanceCall.reverted ? BIG_INT_ZERO : currentBalanceCall.value
  const secondsLeft = rewarder.tokenPerSec == BIG_INT_ZERO ? BIG_INT_ZERO : currentBalance.div(rewarder.tokenPerSec)
  rewarder.endTimestamp = block.timestamp.plus(secondsLeft)
  rewarder.save()

  return rewarder as Rewarder
}

/*
 * get or create history
 */
function getHistory(owner: string, block: ethereum.Block): History {
  const day = block.timestamp.div(BIG_INT_ONE_DAY_SECONDS)

  const id = owner.concat(day.toString())

  let history = History.load(id)

  if (history === null) {
    log.info('[getHistory] creating new history, owner: {}, day: {}', [owner, day.toString()])
    history = new History(id)
    history.owner = owner
    history.flpBalance = BIG_DECIMAL_ZERO
    history.flpAge = BIG_DECIMAL_ZERO
    history.flpAgeRemoved = BIG_DECIMAL_ZERO
    history.flpDeposited = BIG_DECIMAL_ZERO
    history.flpWithdrawn = BIG_DECIMAL_ZERO
    history.timestamp = block.timestamp
    history.block = block.number
  }

  return history as History
}

/*
 * get or create poolHistory
 */
function getPoolHistory(pool: Pool, block: ethereum.Block): PoolHistory {
  const day = block.timestamp.div(BIG_INT_ONE_DAY_SECONDS)

  const id = pool.id.concat(day.toString())

  let history = PoolHistory.load(id)

  if (history === null) {
    log.info('[getPoolHistory] creating new pool history, pool: {}, day: {}', [pool.id, day.toString()])
    history = new PoolHistory(id)
    history.pool = pool.id
    history.flpBalance = BIG_DECIMAL_ZERO
    history.flpAge = BIG_DECIMAL_ZERO
    history.flpAgeRemoved = BIG_DECIMAL_ZERO
    history.flpDeposited = BIG_DECIMAL_ZERO
    history.flpWithdrawn = BIG_DECIMAL_ZERO
    history.userCount = BIG_INT_ZERO
    history.timestamp = block.timestamp
    history.block = block.number
    history.entryUSD = BIG_DECIMAL_ZERO
    history.exitUSD = BIG_DECIMAL_ZERO
    history.voltHarvested = BIG_DECIMAL_ZERO
    history.voltHarvestedUSD = BIG_DECIMAL_ZERO
  }

  return history as PoolHistory
}

/*
 * get or create user
 */
export function getUser(pid: BigInt, address: Address, block: ethereum.Block): User {
  const uid = address.toHex()
  const id = pid.toString().concat('-').concat(uid)

  let user = User.load(id)

  if (user === null) {
    log.info('[getUser] creating new user : {}, pid: {}', [address.toString(), pid.toString()])
    user = new User(id)
    user.pool = null
    user.address = address
    user.amount = BIG_INT_ZERO
    user.rewardDebt = BIG_INT_ZERO
    user.voltHarvested = BIG_DECIMAL_ZERO
    user.voltHarvestedUSD = BIG_DECIMAL_ZERO
    user.entryUSD = BIG_DECIMAL_ZERO
    user.exitUSD = BIG_DECIMAL_ZERO
    user.timestamp = block.timestamp
    user.block = block.number
    user.save()
  }

  return user as User
}
