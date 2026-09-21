-- Importacao BoA 2026 H1 -- parte 08 de 08 (69 linhas)
--
-- Origem: extratos PDF em statement/ (4 contas correntes + 2 faturas CORP).
-- Cada arquivo foi validado contra os totais impressos no proprio extrato, e o
-- conjunto reproduz o saldo de 30/jun/2026 partindo do saldo de 01/jan/2026.
--
-- Rode as partes 01..08 em ordem. Rodar duas vezes e inofensivo: os ids sao
-- deterministicos e o insert tem ON CONFLICT DO NOTHING.
--
-- NAO apague as linhas source='pl_import' antes de carregar tudo -- ate estas
-- linhas entrarem elas sao o unico registro de jan-jun. Backup em
-- r7_ledger_txns_backup_plimport_2026h1 (157 linhas, soma 5151.39).

insert into r7_ledger_transactions
  (id, tenant_id, date, description, amount, account_id, account, source, notes, reconciled, tags)
select v.id, '5dc58fa8-0a0a-4d24-8906-e32755e36e93'::uuid, v.d::date, v.descr, v.amt, a.id, a.name, v.src, v.notes, true, '{}'
from (values
('bstmt_6577_20260625_4d24bcf1','2026-06-25','Twin Liquors LP FintechEFT',-313.82,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260625_740933ec','2026-06-25','Square Inc SQ260625',1257.81,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_7042_20260625_09d3f1f0','2026-06-25','CHEVRON 0379948 ROUND ROCK TX',-29.67,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260625_3b903e1d','2026-06-25','EXXON AA FOOD MART #1 AUSTIN TX',-58.31,'7042','boa_statement','BoA cartao 7042 / portador 9489 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260625_3d78a466','2026-06-25','SAMS CLUB.COM 800-966-6546 AR',-258.23,'7042','boa_statement','BoA cartao 7042 / portador 5982 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260625_4a48e758','2026-06-25','RANDALLS #2636 ROUND ROCK TX',-7.77,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260625_4b654362','2026-06-25','AMAZON MKTPL*1665W4J43 Amzn.com/bill WA',-43.92,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260625_75366996','2026-06-25','H-E-B #057 999-999-9999 TX',-311.07,'7042','boa_statement','BoA cartao 7042 / portador 9489 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260625_d57db0de','2026-06-25','PAYMENTUS CORPORATION 800-420-1663 NC',-23.41,'7042','boa_statement','BoA cartao 7042 / portador 0319 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260625_f9c8f722','2026-06-25','ATMOS ENERGY COMM 888-286-6700 TX',-821.45,'7042','boa_statement','BoA cartao 7042 / portador 0319 / July_Statement_2026-07-07.pdf'),
('bstmt_6577_20260626_26b48e4d','2026-06-26','Square Inc SQ260626',5390.50,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260626_6755aac2','2026-06-26','H-E-B #591 06/26 #000185095 PURCHASE H-E-B #591 ROUND ROCK TX',-64.62,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260626_7928120b','2026-06-26','GRUBHUB INC Jun Actvty',34.18,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260626_a1728975','2026-06-26','RANDALLS #2636 06/26 #000167466 PURCHASE RANDALLS #2636 ROUND ROCK TX',-17.25,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260626_ba971ede','2026-06-26','DoorDash, Inc. 1901 Town',915.98,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260626_d0a9460f','2026-06-26','CHECK 903',-1266.10,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260626_e1b71248','2026-06-26','US FOODSERVICE VENDOR PAY',-2390.75,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260626_ee8bbc32','2026-06-26','Sysco Corporatio PURCHASE',-909.55,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_7042_20260626_3fa6e340','2026-06-26','AMAZON MKTPL*905Z17083 Amzn.com/bill WA',-43.25,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260626_46870fed','2026-06-26','BUC-EE''S #0022 NEW BRAUNFELS TX',-19.48,'7042','boa_statement','BoA cartao 7042 / portador 9489 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260626_4f3cb5a7','2026-06-26','RANDALLS #2636 ROUND ROCK TX',-9.71,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260626_942889f0','2026-06-26','AMAZON MKTPL*BY88O8KL3 Amzn.com/bill WA',-380.91,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260626_95d66cff','2026-06-26','ANTHROPIC* CLAUDE SUB ANTHROPIC.COM CA',-21.32,'7042','boa_statement','BoA cartao 7042 / portador 5982 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260626_9757cbd1','2026-06-26','RANDALLS #2636 ROUND ROCK TX',-12.44,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260626_99b0a422','2026-06-26','RANDALLS #2636 ROUND ROCK TX',-18.39,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260626_9fbb20e4','2026-06-26','AMAZON MKTPL*6J5WJ6Z23 Amzn.com/bill WA',-20.35,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260626_b14b9e7a','2026-06-26','AMAZON RETA* MP7WO3H33 WWW.AMAZON.CO WA',-42.09,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260626_c95e3fb4','2026-06-26','THE WEBSTAURANT STORE INC 717-392-7472 PA',-99.00,'7042','boa_statement','BoA cartao 7042 / portador 9489 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260626_fa2dd5fe','2026-06-26','AMAZON MKTPL*RB12Q3KJ3 Amzn.com/bill WA',-288.33,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260626_fcfda00f','2026-06-26','THE WEBSTAURANT STORE INC 717-392-7472 PA',-221.33,'7042','boa_statement','BoA cartao 7042 / portador 5982 / July_Statement_2026-07-07.pdf'),
('bstmt_6577_20260629_0238617f','2026-06-29','Square Inc SQ260629',3595.09,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260629_09b63014','2026-06-29','Square Inc SQ260629',1877.66,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260629_2da4c319','2026-06-29','KMF KMFUSA.com',-596.05,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260629_8822d71d','2026-06-29','CHECK 1123',-136.27,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260629_caa84171','2026-06-29','CHECKCARD 0627 SP BRAZILMKTAUSTIN 151-22912084 TX',-21.98,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260629_ce05702c','2026-06-29','Square Inc SQ260629',5598.31,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260629_e2809c2d','2026-06-29','H-E-B #591 06/27 #000624380 PURCHASE H-E-B #591 ROUND ROCK TX',-165.95,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_7042_20260629_2f572eb5','2026-06-29','RANDALLS #2636 ROUND ROCK TX',-48.38,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_3132de99','2026-06-29','APPLE.COM/BILL 866-712-7753 CA',-7.99,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_4cdd7c42','2026-06-29','AMAZON MKTPLACE PMTS Amzn.com/bill WA',229.37,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_4d57c34d','2026-06-29','PILOT_00554 GEORGE WEST TX',-50.16,'7042','boa_statement','BoA cartao 7042 / portador 9489 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_5ab4cc35','2026-06-29','AMAZON MKTPL*ZC8F97CS3 Amzn.com/bill WA',-12.98,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_8b254b2e','2026-06-29','THE WEBSTAURANT STORE INC 717-392-7472 PA',-354.57,'7042','boa_statement','BoA cartao 7042 / portador 5982 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_8fb86bb3','2026-06-29','OPENTABLE 800-673-6822 CA',-422.13,'7042','boa_statement','BoA cartao 7042 / portador 9489 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_8fe6ea64','2026-06-29','SAMS CLUB #6259 512-828-0534 TX',-107.75,'7042','boa_statement','BoA cartao 7042 / portador 5982 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_9f8a86c7','2026-06-29','RESTAURANT DEPOT AUSTIN TX',-478.47,'7042','boa_statement','BoA cartao 7042 / portador 5982 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_b24b49b3','2026-06-29','AMAZON RETA* 4W5G220P3 WWW.AMAZON.CO WA',-119.10,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_b551b282','2026-06-29','Microsoft-G167410588 800-6427676 WA',-19.19,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_bbd5a0ca','2026-06-29','THE WEBSTAURANT STORE INC 717-392-7472 PA',-41.54,'7042','boa_statement','BoA cartao 7042 / portador 5982 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_cbc08545','2026-06-29','SP BRAZILMKTAUSTIN 151-22912084 TX',-29.99,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_cce001f8','2026-06-29','SAMSCLUB #6259 512-828-0534 TX',-65.72,'7042','boa_statement','BoA cartao 7042 / portador 5982 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_ec3e83b2','2026-06-29','AMAZON RETA* LY8US4ZT3 WWW.AMAZON.CO WA',-23.76,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_f645a98a','2026-06-29','AMAZON RETA* FC44V8PR3 WWW.AMAZON.CO WA',-28.98,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260629_f653c149','2026-06-29','RANDALLS #2636 ROUND ROCK TX',-8.00,'7042','boa_statement','BoA cartao 7042 / portador 5982 / July_Statement_2026-07-07.pdf'),
('bstmt_6577_20260630_577defba','2026-06-30','Square Inc SQ260630',5301.00,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260630_5e240712','2026-06-30','Online Banking payment to CRD 7042',-3000.00,'6577','internal_transfer','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260630_876aa9ae','2026-06-30','Zelle payment to ZENITE DISTRIBUTION LLC for "Acay"',-655.00,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260630_ac754d56','2026-06-30','Zelle payment to BRAZIL USA IMPORTS CORP for "Food inv. 2354"',-722.80,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_6577_20260630_d75a717d','2026-06-30','UBER USA 6787 EDI PAYMNT',1361.37,'6577','boa_statement','BoA 6577 eStmt_2026-06-30.pdf'),
('bstmt_7042_20260630_0e95909e','2026-06-30','SLING.COM FISERVCOMMUNI CO',-94.98,'7042','boa_statement','BoA cartao 7042 / portador 9489 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260630_14b6d505','2026-06-30','TJMAXX #0266 AUSTIN TX',-27.05,'7042','boa_statement','BoA cartao 7042 / portador 5982 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260630_1a7c0f50','2026-06-30','RANDALLS #2636 ROUND ROCK TX',-22.09,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260630_34cfde2a','2026-06-30','ONLINE PAYMENT FROM CHK 6 577',3000.00,'7042','internal_transfer','BoA cartao 7042 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260630_39259d74','2026-06-30','NORDSTROM RACK #0736 AUSTIN TX',-216.44,'7042','boa_statement','BoA cartao 7042 / portador 5982 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260630_9d712f42','2026-06-30','VERCEL INC. VERCEL.COM CA',-21.32,'7042','boa_statement','BoA cartao 7042 / portador 5982 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260630_b13a1cfc','2026-06-30','RANDALLS #2636 ROUND ROCK TX',-3.78,'7042','boa_statement','BoA cartao 7042 / portador 8349 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260630_bf213883','2026-06-30','CINTAS CORP 972-9967900 OH',-198.83,'7042','boa_statement','BoA cartao 7042 / portador 9489 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260630_ca3eddab','2026-06-30','WAL-MART #5480 ROUND ROCK TX',-322.59,'7042','boa_statement','BoA cartao 7042 / portador 5982 / July_Statement_2026-07-07.pdf'),
('bstmt_7042_20260630_dba86973','2026-06-30','ANTHROPIC* CLAUDE SUB ANTHROPIC.COM CA',-106.60,'7042','boa_statement','BoA cartao 7042 / portador 5982 / July_Statement_2026-07-07.pdf')
) as v(id, d, descr, amt, acct, src, notes)
join r7_ledger_bank_accounts a
  on a.tenant_id = '5dc58fa8-0a0a-4d24-8906-e32755e36e93'::uuid and right(a.name, 4) = v.acct
on conflict (id) do nothing;
