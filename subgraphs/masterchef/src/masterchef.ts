import {
  Add,
  Set,
  Deposit,
  EmergencyWithdraw,
  // MassUpdatePoolsCall,
  MasterChef as MasterChefContract,
  OwnershipTransferred,
  // UpdatePoolCall,
  Withdraw,
} from '../generated/MasterChef/MasterChef'
import { Address, BigDecimal, BigInt, dataSource, ethereum, log } from '@graphprotocol/graph-ts'
import {
  BIG_DECIMAL_1E12,
  BIG_DECIMAL_1E18,
  BIG_DECIMAL_ZERO,
  BIG_INT_ONE,
  BIG_INT_ONE_DAY_SECONDS,
  BIG_INT_ZERO,
  MASTER_CHEF_ADDRESS,
  MASTER_CHEF_START_BLOCK,
} from 'const'
import { History, MasterChef, Pool, PoolHistory, User } from '../generated/schema'
import { getJoePrice, getUSDRate } from 'pricing'

import { ERC20 as ERC20Contract } from '../generated/MasterChef/ERC20'
import { Pair as PairContract } from '../generated/MasterChef/Pair'

export function add(event: Add): void {
  const masterChef = getMasterChef(event.block)
  const allocPoint = event.params.allocPoint

  log.info('Add pool #{}', [allocPoint.toString()])
  const pool = getPool(masterChef.poolCount, event.block)

  // Update MasterChef.
  masterChef.totalAllocPoint = masterChef.totalAllocPoint.plus(allocPoint)
  masterChef.poolCount = masterChef.poolCount.plus(BIG_INT_ONE)
  masterChef.save()
}

export function set(event: Set): void {
  // log.info('Set pool id: {} allocPoint: {} withUpdate: {}', [
  //   call.inputs._pid.toString(),
  //   call.inputs._allocPoint.toString(),
  //   call.inputs._withUpdate ? 'true' : 'false',
  // ])
  const masterChef = getMasterChef(event.block)
  const pool = getPool(event.params.pid, event.block)
  const allocPoint = event.params.allocPoint

  log.info('Set pool #{}, prev: #{}', [allocPoint.toString(), pool.allocPoint.toString()])

  // Update masterchef
  masterChef.totalAllocPoint = masterChef.totalAllocPoint.plus(allocPoint.minus(pool.allocPoint))
  masterChef.save()

  // Update pool
  pool.allocPoint = allocPoint
  pool.save()
}

export function deposit(event: Deposit): void {
  // if (event.params.amount == BIG_INT_ZERO) {
  //   log.info('Deposit zero transaction, input {} hash {}', [
  //     event.transaction.input.toHex(),
  //     event.transaction.hash.toHex(),
  //   ])
  // }
  const userAddress = event.params.user
  const pid = event.params.pid
  const amount = event.params.amount.divDecimal(BIG_DECIMAL_1E18)

  // log.info('{} has deposited {} jlp tokens to pool #{} (masterchef address: #{})', [
  //   event.params.user.toHex(),
  //   event.params.amount.toString(),
  //   event.params.pid.toString(),
  //   MASTER_CHEF_ADDRESS.toHexString(),
  // ])

  const masterChefContract = MasterChefContract.bind(MASTER_CHEF_ADDRESS)

  const poolInfoResult = masterChefContract.try_poolInfo(event.params.pid)
  if (poolInfoResult.reverted) {
    log.info('[masterchef deposit] poolInfo reverted', [])
    return
  }
  const poolInfo = poolInfoResult.value

  const pool = getPool(event.params.pid, event.block)

  const poolHistory = getPoolHistory(pool, event.block)

  const pairContract = PairContract.bind(poolInfo.value0)
  pool.balance = pairContract.balanceOf(MASTER_CHEF_ADDRESS)

  pool.lastRewardTimestamp = poolInfo.value2
  pool.accJoePerShare = poolInfo.value3

  const poolDays = event.block.timestamp.minus(pool.updatedAt).divDecimal(BigDecimal.fromString('86400'))
  pool.jlpAge = pool.jlpAge.plus(poolDays.times(pool.jlpBalance))

  pool.jlpDeposited = pool.jlpDeposited.plus(amount)
  pool.jlpBalance = pool.jlpBalance.plus(amount)

  pool.updatedAt = event.block.timestamp

  const userInfo = masterChefContract.userInfo(event.params.pid, event.params.user)

  const user = getUser(event.params.pid, event.params.user, event.block)

  // If not currently in pool and depositing JLP
  if (!user.pool && event.params.amount.gt(BIG_INT_ZERO)) {
    user.pool = pool.id
    pool.userCount = pool.userCount.plus(BIG_INT_ONE)
  }

  // Calculate JOE being paid out
  if (event.block.number.gt(MASTER_CHEF_START_BLOCK) && user.amount.gt(BIG_INT_ZERO)) {
    const pending = user.amount
      .toBigDecimal()
      .times(pool.accJoePerShare.toBigDecimal())
      .div(BIG_DECIMAL_1E12)
      .minus(user.rewardDebt.toBigDecimal())
      .div(BIG_DECIMAL_1E18)
    // log.info('Deposit: User amount is more than zero, we should harvest {} joe', [pending.toString()])
    if (pending.gt(BIG_DECIMAL_ZERO)) {
      // log.info('Harvesting {} JOE', [pending.toString()])
      const joeHarvestedUSD = pending.times(getJoePrice(event.block))
      user.joeHarvested = user.joeHarvested.plus(pending)
      user.joeHarvestedUSD = user.joeHarvestedUSD.plus(joeHarvestedUSD)
      pool.joeHarvested = pool.joeHarvested.plus(pending)
      pool.joeHarvestedUSD = pool.joeHarvestedUSD.plus(joeHarvestedUSD)
      poolHistory.joeHarvested = pool.joeHarvested
      poolHistory.joeHarvestedUSD = pool.joeHarvestedUSD
    }
  }

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

      // log.info(
      //   'Token {} priceUSD: {} reserve: {} amount: {} / Token {} priceUSD: {} reserve: {} amount: {} - jlp amount: {} total supply: {} share: {}',
      //   [
      //     token0.symbol(),
      //     token0PriceUSD.toString(),
      //     reservesResult.value.value0.toString(),
      //     token0Amount.toString(),
      //     token1.symbol(),
      //     token1PriceUSD.toString(),
      //     reservesResult.value.value1.toString(),
      //     token1Amount.toString(),
      //     amount.toString(),
      //     totalSupply.toString(),
      //     share.toString(),
      //   ]
      // )

      // log.info('User {} has deposited {} JLP tokens {} {} (${}) and {} {} (${}) at a combined value of ${}', [
      //   user.address.toHex(),
      //   amount.toString(),
      //   token0Amount.toString(),
      //   token0.symbol(),
      //   token0USD.toString(),
      //   token1Amount.toString(),
      //   token1.symbol(),
      //   token1USD.toString(),
      //   entryUSD.toString(),
      // ])

      user.entryUSD = user.entryUSD.plus(entryUSD)

      pool.entryUSD = pool.entryUSD.plus(entryUSD)

      poolHistory.entryUSD = pool.entryUSD
    }
  }

  user.save()
  pool.save()

  const masterChef = getMasterChef(event.block)

  const masterChefDays = event.block.timestamp.minus(masterChef.updatedAt).divDecimal(BigDecimal.fromString('86400'))
  masterChef.jlpAge = masterChef.jlpAge.plus(masterChefDays.times(masterChef.jlpBalance))

  masterChef.jlpDeposited = masterChef.jlpDeposited.plus(amount)
  masterChef.jlpBalance = masterChef.jlpBalance.plus(amount)

  masterChef.updatedAt = event.block.timestamp
  masterChef.save()

  const history = getHistory(MASTER_CHEF_ADDRESS.toHex(), event.block)
  history.jlpAge = masterChef.jlpAge
  history.jlpBalance = masterChef.jlpBalance
  history.jlpDeposited = history.jlpDeposited.plus(amount)
  history.save()

  poolHistory.jlpAge = pool.jlpAge
  poolHistory.jlpBalance = pool.balance.divDecimal(BIG_DECIMAL_1E18)
  poolHistory.jlpDeposited = poolHistory.jlpDeposited.plus(amount)
  poolHistory.userCount = pool.userCount
  poolHistory.save()
}

export function withdraw(event: Withdraw): void {
  // if (event.params.amount == BIG_INT_ZERO && User.load(event.params.user.toHex()) !== null) {
  //   log.info('Withdrawal zero transaction, input {} hash {}', [
  //     event.transaction.input.toHex(),
  //     event.transaction.hash.toHex(),
  //   ])
  // }

  const amount = event.params.amount.divDecimal(BIG_DECIMAL_1E18)

  // log.info('{} has withdrawn {} jlp tokens from pool #{}', [
  //   event.params.user.toHex(),
  //   amount.toString(),
  //   event.params.pid.toString(),
  // ])

  const masterChefContract = MasterChefContract.bind(MASTER_CHEF_ADDRESS)

  const poolInfoResult = masterChefContract.try_poolInfo(event.params.pid)
  if (poolInfoResult.reverted) {
    log.info('[masterchef withdraw] poolInfo reverted', [])
    return
  }
  const poolInfo = poolInfoResult.value

  const pool = getPool(event.params.pid, event.block)

  const poolHistory = getPoolHistory(pool, event.block)

  const pairContract = PairContract.bind(poolInfo.value0)
  pool.balance = pairContract.balanceOf(MASTER_CHEF_ADDRESS)
  pool.lastRewardTimestamp = poolInfo.value2
  pool.accJoePerShare = poolInfo.value3

  const poolDays = event.block.timestamp.minus(pool.updatedAt).divDecimal(BigDecimal.fromString('86400'))
  const poolAge = pool.jlpAge.plus(poolDays.times(pool.jlpBalance))
  const poolAgeRemoved = poolAge.div(pool.jlpBalance).times(amount)
  pool.jlpAge = poolAge.minus(poolAgeRemoved)
  pool.jlpAgeRemoved = pool.jlpAgeRemoved.plus(poolAgeRemoved)
  pool.jlpWithdrawn = pool.jlpWithdrawn.plus(amount)
  pool.jlpBalance = pool.jlpBalance.minus(amount)
  pool.updatedAt = event.block.timestamp

  const user = getUser(event.params.pid, event.params.user, event.block)

  if (event.block.number.gt(MASTER_CHEF_START_BLOCK) && user.amount.gt(BIG_INT_ZERO)) {
    const pending = user.amount
      .toBigDecimal()
      .times(pool.accJoePerShare.toBigDecimal())
      .div(BIG_DECIMAL_1E12)
      .minus(user.rewardDebt.toBigDecimal())
      .div(BIG_DECIMAL_1E18)
    // log.info('Withdraw: User amount is more than zero, we should harvest {} JOE - block: {}', [
    //   pending.toString(),
    //   event.block.number.toString(),
    // ])
    // log.info('JOE PRICE {}', [getJoePrice(event.block).toString()])
    if (pending.gt(BIG_DECIMAL_ZERO)) {
      // log.info('Harvesting {} JOE (CURRENT JOE PRICE {})', [
      //   pending.toString(),
      //   getJoePrice(event.block).toString(),
      // ])
      const joeHarvestedUSD = pending.times(getJoePrice(event.block))
      user.joeHarvested = user.joeHarvested.plus(pending)
      user.joeHarvestedUSD = user.joeHarvestedUSD.plus(joeHarvestedUSD)
      pool.joeHarvested = pool.joeHarvested.plus(pending)
      pool.joeHarvestedUSD = pool.joeHarvestedUSD.plus(joeHarvestedUSD)
      poolHistory.joeHarvested = pool.joeHarvested
      poolHistory.joeHarvestedUSD = pool.joeHarvestedUSD
    }
  }

  const userInfo = masterChefContract.userInfo(event.params.pid, event.params.user)

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

      // log.info('User {} has withdrwn {} JLP tokens {} {} (${}) and {} {} (${}) at a combined value of ${}', [
      //   user.address.toHex(),
      //   amount.toString(),
      //   token0Amount.toString(),
      //   token0USD.toString(),
      //   pairContract.token0().toHex(),
      //   token1Amount.toString(),
      //   token1USD.toString(),
      //   pairContract.token1().toHex(),
      //   exitUSD.toString(),
      // ])

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

  const masterChef = getMasterChef(event.block)

  const days = event.block.timestamp.minus(masterChef.updatedAt).divDecimal(BigDecimal.fromString('86400'))
  const jlpAge = masterChef.jlpAge.plus(days.times(masterChef.jlpBalance))
  const jlpAgeRemoved = jlpAge.div(masterChef.jlpBalance).times(amount)
  masterChef.jlpAge = jlpAge.minus(jlpAgeRemoved)
  masterChef.jlpAgeRemoved = masterChef.jlpAgeRemoved.plus(jlpAgeRemoved)

  masterChef.jlpWithdrawn = masterChef.jlpWithdrawn.plus(amount)
  masterChef.jlpBalance = masterChef.jlpBalance.minus(amount)
  masterChef.updatedAt = event.block.timestamp
  masterChef.save()

  const history = getHistory(MASTER_CHEF_ADDRESS.toHex(), event.block)
  history.jlpAge = masterChef.jlpAge
  history.jlpAgeRemoved = history.jlpAgeRemoved.plus(jlpAgeRemoved)
  history.jlpBalance = masterChef.jlpBalance
  history.jlpWithdrawn = history.jlpWithdrawn.plus(amount)
  history.save()

  poolHistory.jlpAge = pool.jlpAge
  poolHistory.jlpAgeRemoved = poolHistory.jlpAgeRemoved.plus(jlpAgeRemoved)
  poolHistory.jlpBalance = pool.balance.divDecimal(BIG_DECIMAL_1E18)
  poolHistory.jlpWithdrawn = poolHistory.jlpWithdrawn.plus(amount)
  poolHistory.userCount = pool.userCount
  poolHistory.save()
}

export function emergencyWithdraw(event: EmergencyWithdraw): void {
  log.info('User {} emergancy withdrawal of {} from pool #{}', [
    event.params.user.toHex(),
    event.params.amount.toString(),
    event.params.pid.toString(),
  ])

  const pool = getPool(event.params.pid, event.block)

  const pairContract = PairContract.bind(pool.pair as Address)
  pool.balance = pairContract.balanceOf(MASTER_CHEF_ADDRESS)
  pool.save()

  // Update user
  const user = getUser(event.params.pid, event.params.user, event.block)
  user.amount = BIG_INT_ZERO
  user.rewardDebt = BIG_INT_ZERO

  user.save()
}

export function ownershipTransferred(event: OwnershipTransferred): void {
  log.info('Ownership transfered from previous owner: {} to new owner: {}', [
    event.params.previousOwner.toHex(),
    event.params.newOwner.toHex(),
  ])
}

/*
 * Utility functions
 *
 */

function getMasterChef(block: ethereum.Block): MasterChef {
  let masterChef = MasterChef.load(MASTER_CHEF_ADDRESS.toHex())

  if (masterChef === null) {
    const contract = MasterChefContract.bind(MASTER_CHEF_ADDRESS)
    masterChef = new MasterChef(MASTER_CHEF_ADDRESS.toHex())
    masterChef.bonusMultiplier = contract.BONUS_MULTIPLIER()
    // masterChef.bonusEndBlock = contract.bonusEndBlock()
    masterChef.devaddr = contract.devaddr()
    masterChef.treasuryaddr = contract.treasuryaddr()
    // masterChef.migrator = contract.migrator()
    masterChef.owner = contract.owner()
    // poolInfo ...
    masterChef.startTimestamp = contract.startTimestamp()
    masterChef.joe = contract.joe()
    masterChef.joePerSec = contract.joePerSec()
    masterChef.totalAllocPoint = contract.totalAllocPoint()
    // userInfo ...
    masterChef.poolCount = BIG_INT_ZERO

    masterChef.jlpBalance = BIG_DECIMAL_ZERO
    masterChef.jlpAge = BIG_DECIMAL_ZERO
    masterChef.jlpAgeRemoved = BIG_DECIMAL_ZERO
    masterChef.jlpDeposited = BIG_DECIMAL_ZERO
    masterChef.jlpWithdrawn = BIG_DECIMAL_ZERO

    masterChef.updatedAt = block.timestamp

    masterChef.save()
  }

  return masterChef as MasterChef
}

export function getPool(id: BigInt, block: ethereum.Block): Pool {
  let pool = Pool.load(id.toString())

  if (pool === null) {
    const masterChef = getMasterChef(block)

    const masterChefContract = MasterChefContract.bind(MASTER_CHEF_ADDRESS)

    // Create new pool.
    pool = new Pool(id.toString())

    // Set relation
    pool.owner = masterChef.id

    const poolInfoResult = masterChefContract.try_poolInfo(masterChef.poolCount)
    if (poolInfoResult.reverted) {
      log.info('[masterchef getPool] poolInfo reverted', [])
      return null
    }
    const poolInfo = poolInfoResult.value

    pool.pair = poolInfo.value0
    pool.allocPoint = poolInfo.value1
    pool.lastRewardTimestamp = poolInfo.value2
    pool.accJoePerShare = poolInfo.value3

    // Total supply of LP tokens
    pool.balance = BIG_INT_ZERO
    pool.userCount = BIG_INT_ZERO

    pool.jlpBalance = BIG_DECIMAL_ZERO
    pool.jlpAge = BIG_DECIMAL_ZERO
    pool.jlpAgeRemoved = BIG_DECIMAL_ZERO
    pool.jlpDeposited = BIG_DECIMAL_ZERO
    pool.jlpWithdrawn = BIG_DECIMAL_ZERO

    pool.timestamp = block.timestamp
    pool.block = block.number

    pool.updatedAt = block.timestamp
    pool.entryUSD = BIG_DECIMAL_ZERO
    pool.exitUSD = BIG_DECIMAL_ZERO
    pool.joeHarvested = BIG_DECIMAL_ZERO
    pool.joeHarvestedUSD = BIG_DECIMAL_ZERO
    pool.save()
  }

  return pool as Pool
}

function getHistory(owner: string, block: ethereum.Block): History {
  const day = block.timestamp.div(BIG_INT_ONE_DAY_SECONDS)

  const id = owner.concat(day.toString())

  let history = History.load(id)

  if (history === null) {
    history = new History(id)
    history.owner = owner
    history.jlpBalance = BIG_DECIMAL_ZERO
    history.jlpAge = BIG_DECIMAL_ZERO
    history.jlpAgeRemoved = BIG_DECIMAL_ZERO
    history.jlpDeposited = BIG_DECIMAL_ZERO
    history.jlpWithdrawn = BIG_DECIMAL_ZERO
    history.timestamp = block.timestamp
    history.block = block.number
  }

  return history as History
}

function getPoolHistory(pool: Pool, block: ethereum.Block): PoolHistory {
  const day = block.timestamp.div(BIG_INT_ONE_DAY_SECONDS)

  const id = pool.id.concat(day.toString())

  let history = PoolHistory.load(id)

  if (history === null) {
    history = new PoolHistory(id)
    history.pool = pool.id
    history.jlpBalance = BIG_DECIMAL_ZERO
    history.jlpAge = BIG_DECIMAL_ZERO
    history.jlpAgeRemoved = BIG_DECIMAL_ZERO
    history.jlpDeposited = BIG_DECIMAL_ZERO
    history.jlpWithdrawn = BIG_DECIMAL_ZERO
    history.timestamp = block.timestamp
    history.block = block.number
    history.entryUSD = BIG_DECIMAL_ZERO
    history.exitUSD = BIG_DECIMAL_ZERO
    history.joeHarvested = BIG_DECIMAL_ZERO
    history.joeHarvestedUSD = BIG_DECIMAL_ZERO
  }

  return history as PoolHistory
}

export function getUser(pid: BigInt, address: Address, block: ethereum.Block): User {
  const uid = address.toHex()
  const id = pid.toString().concat('-').concat(uid)

  let user = User.load(id)

  if (user === null) {
    user = new User(id)
    user.pool = null
    user.address = address
    user.amount = BIG_INT_ZERO
    user.rewardDebt = BIG_INT_ZERO
    user.joeHarvested = BIG_DECIMAL_ZERO
    user.joeHarvestedUSD = BIG_DECIMAL_ZERO
    user.entryUSD = BIG_DECIMAL_ZERO
    user.exitUSD = BIG_DECIMAL_ZERO
    user.timestamp = block.timestamp
    user.block = block.number
    user.save()
  }

  return user as User
}

// // Calls

// export function setMigrator(call: SetMigratorCall): void {
//   log.info('Set migrator to {}', [call.inputs._migrator.toHex()])

//   const masterChef = getMasterChef(call.block)
//   masterChef.migrator = call.inputs._migrator
//   masterChef.save()
// }

// export function migrate(call: MigrateCall): void {
//   const masterChefContract = MasterChefContract.bind(MASTER_CHEF_ADDRESS)

//   const pool = getPool(call.inputs._pid, call.block)

//   const poolInfo = masterChefContract.poolInfo(call.inputs._pid)

//   const pair = poolInfo.value0

//   const pairContract = PairContract.bind(pair as Address)

//   pool.pair = pair

//   const balance = pairContract.balanceOf(MASTER_CHEF_ADDRESS)

//   pool.balance = balance

//   pool.save()
// }

// export function massUpdatePools(call: MassUpdatePoolsCall): void {
//   log.info('Mass update pools', [])
// }

// export function updatePool(call: UpdatePoolCall): void {
//   log.info('Update pool id {}', [call.inputs._pid.toString()])

//   const masterChef = MasterChefContract.bind(MASTER_CHEF_ADDRESS)
//   const poolInfo = masterChef.poolInfo(call.inputs._pid)
//   const pool = getPool(call.inputs._pid, call.block)
//   pool.lastRewardTimestamp = poolInfo.value2
//   pool.accJoePerShare = poolInfo.value3
//   pool.save()
// }
// export function dev(call: DevCall): void {
//   log.info('Dev changed to {}', [call.inputs._devaddr.toHex()])

//   const masterChef = getMasterChef(call.block)

//   masterChef.devaddr = call.inputs._devaddr

//   masterChef.save()
// }
