const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name) // If we are NOT on a development chain, skip it
    ? describe.skip
    : describe("Raffle Unit Tests", () => {
          //FUNCTION ON DESCRIBE DON'T NEED TO BE ASYNC!!! ON "IT" IT'S NECESARY
          let deployer, raffle, vrfCoordinatorV2Mock, raffleEntranceFee, interval
          const chainId = network.config.chainId

          beforeEach(async () => {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              raffle = await ethers.getContract("Raffle", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              raffleEntranceFee = await raffle.getEntranceFee()
              interval = await raffle.getInterval()
          })

          describe("constructor", () => {
              it("initialices the raffle correctly", async () => {
                  const raffleState = await raffle.getRaffleState()
                  assert.equal(raffleState.toString(), "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["keepersUpdateInterval"])
              })
          })
          describe("enterRaffle", () => {
              it("reverts when you don't pay enough", async () => {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughEthEntered"
                  )
              })
              it("records players when they enter", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  const playerFromContract = await raffle.getPlayer(0)
                  assert.equal(playerFromContract, deployer)
              })
              it("emits event on enter", async () => {
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEnter"
                  )
              })
              it("doesn't allow entrance when raffle is calculating", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  /*Here we need to take a "Time travel", for the lottery
                to end and its state would be calculating
                This is the way to do it with Hardhat*/
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]) //Time has passed
                  await network.provider.send(
                      "evm_mine",
                      []
                  ) /*all the conditions for checkUpkeep are met, so now
                  it automatically calls performUpkeep, where the variable will change to "calculating"*/
                  await raffle.performUpkeep([]) //changes the state to calculating for our comparison below
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle__NotOpen"
                  )
              })
          })
          describe("checkUpkeep", () => {
              it("returns false if people haven't entered the raffle", async () => {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep(
                      []
                  ) /*As checkUpkeep is not a VIEW function,
                we should callStatic to get its arguments in return*/
                  assert(!upkeepNeeded) //Assert not false (It will be true)
              })
              it("returns false if raffle isn't open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  await raffle.performUpkeep([])
                  const raffleState = await raffle.getRaffleState()
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.equal(raffleState.toString(), "1")
                  assert.equal(upkeepNeeded, false)
              })
              it("returns false if enough time hasn't passed", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(!upkeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  //We can use ("0x") or [] when we call a function and we don't wanna give it any params
                  assert(upkeepNeeded)
              })
          })
          describe("performUpkeep", () => {
              it("it can only run if checkupkeep is true", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const tx = await raffle.performUpkeep([])
                  assert(tx)
              })
              it("reverts when checkupkeep is false", async () => {
                  await expect(raffle.performUpkeep([])).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  )
              })
              it("updates the raffle state, emits the event, and calls VRFCoordinator", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const txResponse = await raffle.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId //It's the second event. The first would be 0
                  const raffleState = await raffle.getRaffleState()
                  assert(requestId.toNumber() > 0)
                  assert(raffleState == 1)
              })
          })
          describe("fullfillRandomWords", () => {
              beforeEach(async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
              })
              it("can only be called after performUpkeep", async () => {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
              })
              it("picks a winner, resets the lottery, and sends money to the winner", async () => {
                  const additionalEntrants = 3
                  const startingAccountIndex = 1 //Deployer = 0, account 1 = 1 ... 3 participants (no counting deployer)
                  const accounts = await ethers.getSigners()
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrants;
                      i++
                  ) {
                      const accountConnectedRaffle = raffle.connect(accounts[i])
                      await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee })
                  } //we are connecting 3 more people on the raffle, so 4 in total with the deployer
                  const startingTimeStamp = await raffle.getLatestTimeStamp()

                  /* We do all this because on a real testnet we cannot pretend to be the Chainlink Keepers or the VRF
                  to call the functions, so this is how we would do it on a staging test actually. Throwing requests
                  and waiting for the VRF to respond calling it's internal functions which we CAN NOT CALL */
                  await new Promise(async (resolve, reject) => {
                      //THIS IS A LISTENER FOR SOME EVENT CALL!
                      //We are basically saying "When you hear WinnerPicked (event), do the stuff in the function"
                      //The winnerPicked event will be called BELOW!, on the line +192
                      raffle.once("WinnerPicked", async () => {
                          // When the WinnerPicked event gets fired by the code below, it will do:
                          console.log("WinnerPicked event fired!")
                          try {
                              //We will see if everything gets reset (players array, raffleState, ...)
                              const recentWinner = await raffle.getLatestWinner()
                              //   console.log("Winner is: ...")
                              //   console.log(recentWinner)
                              //   console.log("Showing all the entrants below: ...")
                              //   console.log(accounts[0].address)
                              //   console.log(accounts[1].address)
                              //   console.log(accounts[2].address)
                              //   console.log(accounts[3].address)
                              /* Once we know the winner, we don't need to see who is it all the time
                            (It's always the same winner) */

                              const raffleState = await raffle.getRaffleState()
                              const endingTimeStamp = await raffle.getLatestTimeStamp()
                              const numPlayers = await raffle.getNumberOfPlayers()
                              const winnerEndingBalance = await accounts[1].getBalance()
                              assert.equal(numPlayers, 0)
                              assert.equal(raffleState.toString(), "0")
                              assert(endingTimeStamp > startingTimeStamp)

                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance
                                      .add(
                                          raffleEntranceFee
                                              .mul(additionalEntrants) //3 participants
                                              .add(raffleEntranceFee) // the deployer participates too!
                                      )
                                      .toString()
                              )
                          } catch (e) {
                              reject(
                                  e
                              ) /* If we don't see the event in the máx timeout (200s on the config ("mocha")),
                              it will be rejected and fail */
                          }
                          resolve()
                      })
                      const tx = await raffle.performUpkeep([])
                      const txReceipt = await tx.wait(1)
                      const winnerStartingBalance = await accounts[1].getBalance() //This line is added after
                      /*Now that we ran the test once we know that the winner is account 1
                      (we saw on the console.logs). So, lets check that he recieves the prize */
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          raffle.address
                      ) /* We are mocking the chainlink keepers and the VRF.
                      If it's all right, fulfillRandomWords will call WinnerPicked when succesfully called */
                  })
              })
          })
      })
