# 警備員勤務希望管理システム

Firebase Sparkプラン向けの試作版です。Firebase Authentication、Cloud Firestore、Firebase Hostingだけを使用します。

functionsフォルダは将来Blazeプランへ移行する場合の参考コードとして残していますが、現在は未使用で、クライアントから呼び出さず、通常デプロイの対象にも含めません。

デプロイ:

    npx -y firebase-tools@latest deploy --only hosting,firestore:rules,firestore:indexes
