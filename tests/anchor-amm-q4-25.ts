import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { AnchorAmmQ425 } from "../target/types/anchor_amm_q4_25";

const u64Le = (value: anchor.BN) => {
  const bn = BigInt(value.toString());
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(bn, 0);
  return buffer;
};

describe("anchor-amm-q4-25", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const wallet = provider.wallet as anchor.Wallet & {
    payer: anchor.web3.Keypair;
  };

  const program = anchor.workspace.anchorAmmQ425 as Program<AnchorAmmQ425>;

  it("happy path: initialize, deposit, withdraw, swap", async () => {
    const seed = new anchor.BN(Date.now());
    const feeBps = 30;

    const mintX = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6
    );

    const mintY = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6
    );

    const [config] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config"), u64Le(seed)],
      program.programId
    );

    const [mintLp] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), config.toBuffer()],
      program.programId
    );

    const vaultX = getAssociatedTokenAddressSync(mintX, config, true);
    const vaultY = getAssociatedTokenAddressSync(mintY, config, true);

    const userX = getAssociatedTokenAddressSync(mintX, wallet.publicKey);
    const userY = getAssociatedTokenAddressSync(mintY, wallet.publicKey);
    const userLp = getAssociatedTokenAddressSync(mintLp, wallet.publicKey);

    await createAssociatedTokenAccountIdempotent(
      provider.connection,
      wallet.payer,
      mintX,
      wallet.publicKey
    );

    await createAssociatedTokenAccountIdempotent(
      provider.connection,
      wallet.payer,
      mintY,
      wallet.publicKey
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      mintX,
      userX,
      wallet.publicKey,
      2_000_000
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      mintY,
      userY,
      wallet.publicKey,
      2_000_000
    );

    await program.methods
      .initialize(seed, feeBps, null)
      .accounts({
        initializer: wallet.publicKey,
        mintX,
        mintY,
        mintLp,
        vaultX,
        vaultY,
        config,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();

    const depositAmount = new anchor.BN(500_000);
    const maxX = new anchor.BN(600_000);
    const maxY = new anchor.BN(600_000);

    await program.methods
      .deposit(depositAmount, maxX, maxY)
      .accounts({
        user: wallet.publicKey,
        mintX,
        mintY,
        config,
        mintLp,
        vaultX,
        vaultY,
        userX,
        userY,
        userLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();

    const lpAfterDeposit = await getAccount(provider.connection, userLp);
    expect(lpAfterDeposit.amount).to.equal(BigInt(depositAmount.toString()));

    const withdrawAmount = new anchor.BN(100_000);
    const userXBeforeWithdraw = await getAccount(provider.connection, userX);
    const userYBeforeWithdraw = await getAccount(provider.connection, userY);

    await program.methods
      .withdraw(withdrawAmount, new anchor.BN(1), new anchor.BN(1))
      .accounts({
        user: wallet.publicKey,
        mintX,
        mintY,
        config,
        mintLp,
        vaultX,
        vaultY,
        userX,
        userY,
        userLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();

    const userXAfterWithdraw = await getAccount(provider.connection, userX);
    const userYAfterWithdraw = await getAccount(provider.connection, userY);
    const lpAfterWithdraw = await getAccount(provider.connection, userLp);

    expect(userXAfterWithdraw.amount > userXBeforeWithdraw.amount).to.equal(
      true
    );
    expect(userYAfterWithdraw.amount > userYBeforeWithdraw.amount).to.equal(
      true
    );
    expect(lpAfterWithdraw.amount).to.equal(
      BigInt(depositAmount.sub(withdrawAmount).toString())
    );

    const userYBeforeSwap = await getAccount(provider.connection, userY);

    await program.methods
      .swap(true, new anchor.BN(50_000), new anchor.BN(1))
      .accounts({
        user: wallet.publicKey,
        mintX,
        mintY,
        config,
        mintLp,
        vaultX,
        vaultY,
        userX,
        userY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();

    const userYAfterSwap = await getAccount(provider.connection, userY);
    expect(userYAfterSwap.amount > userYBeforeSwap.amount).to.equal(true);
  });
});
