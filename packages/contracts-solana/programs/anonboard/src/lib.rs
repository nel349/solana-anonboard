//! Solana program backing the anonboard example — account-storage version.
//!
//! Posts are stored as program-owned accounts (state), not just log lines (history), so a
//! post is read back in O(1) with `getAccountInfo` and never depends on RPC log retention.
//!
//! Instructions:
//!   - `Post(body)`  (disc 2): create the author's counter on first post, create the indexed
//!     post PDA `["post", author, index]` (sponsor-funded), write the record, bump the
//!     counter, AND emit `ANONBOARD_POST|author|slot|body` (dual-write, so the log reader
//!     still works during the transition).
//!   - `Close`       (disc 3): the author deletes one of their posts; the rent is refunded to
//!     the ORIGINAL payer (the sponsor), never to the author — so a post can't drain the
//!     sponsor. The counter is not decremented (indices are monotonic; a closed slot is a gap).
//!
//! Gasless: the author only *signs*; the sponsor is the fee payer AND funds account rent.
//! No Anchor — plain `solana-program`, manual byte layout, builds with vendored cargo-build-sbf.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

solana_program::declare_id!("8veT8XVnBxG6kmq27CrCgznCtVHLJsBAqGHZrodKaRJ6");

// Instruction discriminants (first data byte).
pub const DISCRIMINANT_POST: u8 = 2;
pub const DISCRIMINANT_CLOSE: u8 = 3;

// Account tags (first data byte) so `getProgramAccounts` can filter posts from counters.
const TAG_POST: u8 = 1;
const TAG_COUNTER: u8 = 2;

// PDA seed prefixes.
const SEED_POST: &[u8] = b"post";
const SEED_COUNTER: &[u8] = b"author";

// Bounded so account size — and thus rent — is fixed and known.
const MAX_BODY: usize = 280;

// Post account layout: tag(1) | author(32) | payer(32) | slot(8) | index(8) | body_len(2) | body(MAX_BODY)
const POST_OFF_AUTHOR: usize = 1;
const POST_OFF_PAYER: usize = 33;
const POST_OFF_SLOT: usize = 65;
const POST_OFF_INDEX: usize = 73;
const POST_OFF_BODY_LEN: usize = 81;
const POST_OFF_BODY: usize = 83;
const POST_SIZE: usize = POST_OFF_BODY + MAX_BODY;

// Counter account layout: tag(1) | count(8)
const COUNTER_SIZE: usize = 9;

entrypoint!(process_instruction);

pub fn process_instruction<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    instruction_data: &[u8],
) -> ProgramResult {
    match instruction_data.first().copied() {
        Some(DISCRIMINANT_POST) => handle_post(program_id, accounts, &instruction_data[1..]),
        Some(DISCRIMINANT_CLOSE) => handle_close(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// Create a program-owned PDA account, rent funded by `payer`, signed by the PDA seeds.
///
/// Robust against a pre-funded target: `create_account` fails if the PDA already holds
/// lamports, which an attacker could exploit by sending 1 lamport to a victim's (deterministic)
/// counter/post PDA to block their post. So if the account is already funded we initialize it
/// manually instead — top up to rent-exempt, then allocate + assign — which cannot be blocked.
fn create_pda<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    new_account: &AccountInfo<'a>,
    system_prog: &AccountInfo<'a>,
    signer_seeds: &[&[u8]],
    space: usize,
) -> ProgramResult {
    let rent = Rent::get()?.minimum_balance(space);
    if new_account.lamports() == 0 {
        return invoke_signed(
            &system_instruction::create_account(payer.key, new_account.key, rent, space as u64, program_id),
            &[payer.clone(), new_account.clone(), system_prog.clone()],
            &[signer_seeds],
        );
    }
    // Pre-funded (griefing or a stray transfer): create_account would fail, so init in place.
    if new_account.lamports() < rent {
        invoke(
            &system_instruction::transfer(payer.key, new_account.key, rent - new_account.lamports()),
            &[payer.clone(), new_account.clone(), system_prog.clone()],
        )?;
    }
    invoke_signed(
        &system_instruction::allocate(new_account.key, space as u64),
        &[new_account.clone(), system_prog.clone()],
        &[signer_seeds],
    )?;
    invoke_signed(
        &system_instruction::assign(new_account.key, program_id),
        &[new_account.clone(), system_prog.clone()],
        &[signer_seeds],
    )
}

fn handle_post<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
    body: &[u8],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let author = next_account_info(iter)?;
    let counter = next_account_info(iter)?;
    let post = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let system_prog = next_account_info(iter)?;

    if !author.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system_prog.key != &system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if body.len() > MAX_BODY {
        return Err(ProgramError::InvalidInstructionData);
    }
    // Validate UTF-8 up front (also what the log line needs).
    let body_str = core::str::from_utf8(body).map_err(|_| ProgramError::InvalidInstructionData)?;

    // ── author counter: create on first post, then read the next index ──
    let (counter_key, counter_bump) =
        Pubkey::find_program_address(&[SEED_COUNTER, author.key.as_ref()], program_id);
    if counter.key != &counter_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if counter.data_is_empty() {
        create_pda(
            program_id,
            payer,
            counter,
            system_prog,
            &[SEED_COUNTER, author.key.as_ref(), &[counter_bump]],
            COUNTER_SIZE,
        )?;
        let mut cdata = counter.try_borrow_mut_data()?;
        cdata[0] = TAG_COUNTER;
        cdata[1..9].copy_from_slice(&0u64.to_le_bytes());
    }
    let index = {
        let cdata = counter.try_borrow_data()?;
        u64::from_le_bytes(cdata[1..9].try_into().unwrap())
    };

    // ── create the indexed post PDA and write the record ──
    let (post_key, post_bump) = Pubkey::find_program_address(
        &[SEED_POST, author.key.as_ref(), &index.to_le_bytes()],
        program_id,
    );
    if post.key != &post_key {
        return Err(ProgramError::InvalidSeeds);
    }
    create_pda(
        program_id,
        payer,
        post,
        system_prog,
        &[SEED_POST, author.key.as_ref(), &index.to_le_bytes(), &[post_bump]],
        POST_SIZE,
    )?;
    let slot = Clock::get()?.slot;
    {
        let mut pdata = post.try_borrow_mut_data()?;
        pdata[0] = TAG_POST;
        pdata[POST_OFF_AUTHOR..POST_OFF_AUTHOR + 32].copy_from_slice(author.key.as_ref());
        pdata[POST_OFF_PAYER..POST_OFF_PAYER + 32].copy_from_slice(payer.key.as_ref());
        pdata[POST_OFF_SLOT..POST_OFF_SLOT + 8].copy_from_slice(&slot.to_le_bytes());
        pdata[POST_OFF_INDEX..POST_OFF_INDEX + 8].copy_from_slice(&index.to_le_bytes());
        pdata[POST_OFF_BODY_LEN..POST_OFF_BODY_LEN + 2]
            .copy_from_slice(&(body.len() as u16).to_le_bytes());
        pdata[POST_OFF_BODY..POST_OFF_BODY + body.len()].copy_from_slice(body);
    }

    // ── bump the counter (indices are monotonic; overflow-checks on in release) ──
    {
        let mut cdata = counter.try_borrow_mut_data()?;
        let next = index.checked_add(1).ok_or(ProgramError::InvalidAccountData)?;
        cdata[1..9].copy_from_slice(&next.to_le_bytes());
    }

    // ── dual-write: keep the log line so the log reader still works during transition ──
    msg!("ANONBOARD_POST|{}|{}|{}", author.key, slot, body_str);
    Ok(())
}

fn handle_close<'a>(
    program_id: &Pubkey,
    accounts: &'a [AccountInfo<'a>],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let author = next_account_info(iter)?;
    let post = next_account_info(iter)?;
    let refund_dest = next_account_info(iter)?;

    if !author.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if post.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    let (stored_author, stored_payer) = {
        let pdata = post.try_borrow_data()?;
        if pdata.first().copied() != Some(TAG_POST) {
            return Err(ProgramError::InvalidAccountData);
        }
        (
            Pubkey::new_from_array(pdata[POST_OFF_AUTHOR..POST_OFF_AUTHOR + 32].try_into().unwrap()),
            Pubkey::new_from_array(pdata[POST_OFF_PAYER..POST_OFF_PAYER + 32].try_into().unwrap()),
        )
    };
    // Only the post's author may delete it; rent is refunded to the ORIGINAL payer (sponsor),
    // never to the author — otherwise closing would let the author extract the sponsor's SOL.
    if author.key != &stored_author {
        return Err(ProgramError::IllegalOwner);
    }
    if refund_dest.key != &stored_payer {
        return Err(ProgramError::InvalidArgument);
    }

    let lamports = post.lamports();
    **refund_dest.try_borrow_mut_lamports()? = refund_dest
        .lamports()
        .checked_add(lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    **post.try_borrow_mut_lamports()? = 0;
    // Zero + shrink the data and hand ownership back to the system program so the runtime
    // reclaims the (now zero-lamport) account.
    post.try_borrow_mut_data()?.fill(0);
    post.realloc(0, false)?;
    post.assign(&system_program::ID);
    Ok(())
}
