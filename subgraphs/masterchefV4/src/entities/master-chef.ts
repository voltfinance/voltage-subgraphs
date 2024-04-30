import { Address, ethereum } from "@graphprotocol/graph-ts";
import { BIG_INT_ZERO } from "const";
import { MasterChef as MasterChefEntity } from '../../generated/schema'
import { MasterChefV4 } from '../../generated/MasterChefV4/MasterChefV4'

export function getOrCreateMasterChef(masterChefAddress: Address, block: ethereum.Block): MasterChefEntity {
    let masterChef = MasterChefEntity.load(masterChefAddress.toHexString())

    if (masterChef === null) {
        masterChef = new MasterChefEntity(masterChefAddress.toHexString())
        masterChef.totalAllocPoint = BIG_INT_ZERO
        masterChef.lastHarvestBlock = BIG_INT_ZERO
        masterChef.undistributedVolt = BIG_INT_ZERO
        masterChef.poolCount = BIG_INT_ZERO
        masterChef.voltPerSec = BIG_INT_ZERO
        
    }
    let masterChefContract = MasterChefV4.bind(masterChefAddress)
    
    let voltPerSecValue = masterChefContract.try_getMasterChefV4VoltPerSec()
    if (!voltPerSecValue.reverted) {
        masterChef.voltPerSec = voltPerSecValue.value
    }

    masterChef.timestamp = block.timestamp
    masterChef.block = block.number
    masterChef.save()

    return masterChef as MasterChefEntity
}