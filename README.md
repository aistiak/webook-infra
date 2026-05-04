# webhook-infra-lib


### how to run 

1. have to run the infra first 
run `docker-compose up -d` at the root of the porject
2. cd to the `demo-app` dir and install dependencies with `npm install`
3. make a curl request to obtail the api key
```
curl -X POST 'http://localhost:3000/api/account' \
  --header 'User-Agent: yaak' \
  --header 'Accept: */*' \
  --header 'Content-Type: application/json' \
  --data '{
  "username": "istiak"
}'
you will get api key in the response 
```
4. run `cp .env.example .env` in the deomp-app dir
5. update the WEBHOOK_API_KEY with the api key from curl response
6. 