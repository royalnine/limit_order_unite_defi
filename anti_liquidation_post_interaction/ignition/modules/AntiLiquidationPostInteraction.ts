import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const AntiLiquidationPostInteractionModule = buildModule("AntiLiquidationPostInteractionModule", (m) => {

    const cm = m.contract("AntiLiquidationPostInteraction", [], {
    });
  
    return { cm };
  });
  
  export default AntiLiquidationPostInteractionModule;