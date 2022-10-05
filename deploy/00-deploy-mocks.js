const { network } = require("hardhat")
const { developmentChains } = require("../helper-hardhat-config")

const BASE_FEE = ethers.utils.parseEther("0.25") //0.25 is the premium. It costs 0.25 LINK per request
const GAS_PRICE_LINK = 1e9 //calculated value based on the gas price of the chain (Link per gas)
//those 2 are the args for the deployment of the mock

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()
    const args = [BASE_FEE, GAS_PRICE_LINK]

    if (developmentChains.includes(network.name)) {
        console.log("Local network detected! Deploying mocks...")
        //Deploy a mock VRFcoordinatorV2
        await deploy("VRFCoordinatorV2Mock", {
            from: deployer,
            log: true,
            args: args,
        })
        console.log("Mocks Deployed!")
        console.log("------------------------------------------------")
    }
}
module.exports.tags = ["all", "mocks"]
