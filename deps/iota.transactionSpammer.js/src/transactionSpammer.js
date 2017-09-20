/**
 * Created by Peter Ryszkiewicz (https://github.com/pRizz) on 9/10/2017.
 * https://github.com/pRizz/iota.transactionSpammer.js
 */

window.iotaTransactionSpammer = (function(){
    const iotaLib = window.IOTA
    const curl = window.curl
    var iota // initialized in initializeIOTA
    var started = false

    // TODO: use this for listening to changes in options and emit change to eventEmitter
    const optionsProxy = new Proxy({
        isLoadBalancing: true // change node after every PoW
    }, {
        set: (obj, prop, value) => {
            obj[prop] = value
            eventEmitter.emitEvent('optionChanged', [prop, value])
            return true
        }
    })

    // from 'https://iotasupport.com/providers.json' + requested additions - unreliable nodes
    const httpProviders = [
        "http://service.iotasupport.com:14265",
        "http://node01.iotatoken.nl:14265",
        "http://node02.iotatoken.nl:14265",
        "http://node03.iotatoken.nl:15265",
        "http://mainnet.necropaz.com:14500",
        "http://5.9.137.199:14265",
        "http://5.9.118.112:14265",
        "http://5.9.149.169:14265",
        "http://88.198.230.98:14265",
        "http://176.9.3.149:14265",
        "http://node.lukaseder.de:14265",
        "http://iota.preissler.me:80"
    ]

    const httpsProviders = [
        //'https://node.tangle.works:443', // commented out due to network issues; asked by node operator
        //'https://n1.iota.nu:443' // commented out due to network issues; asked by node operator
        "https://iota.preissler.me:443"
    ]

    const validProviders = getValidProviders()
    var _currentProvider = getRandomProvider()

    // Overrides the _currentProvider
    var customProvider = null

    var depth = 10
    var weight = 15
    var spamSeed = generateSeed()
    var spamAddress
    var tipsHashes
    var tipTransactions
    var tipIndex

    const hostingSite = 'https://github.com/pRizz/iota.transactionSpammer.js'
    const hostingSiteTritified = tritifyURL(hostingSite)
    var message = hostingSiteTritified
    var tag = "REATTACHER"
    var numberOfTransfersInBundle = 1

    const eventEmitter = new EventEmitter()

    var transactionCount = 0
    var confirmationCount = 0
    var averageConfirmationDuration = 0 // milliseconds
    var confirmationTimes = []

    function getCurrentProvider() {
        if (customProvider) { return customProvider }
        return _currentProvider
    }

    // must be https if the hosting site is served over https; SSL rules
    function getValidProviders() {
        if(isRunningOverHTTPS()) {
            return httpsProviders
        } else {
            return httpProviders.concat(httpsProviders)
        }
    }

    function isRunningOverHTTPS() {
        switch(window.location.protocol) {
            case 'https:':
                return true
            default:
                return false
        }
    }

    // returns a depth in [4, 12] inclusive
    function generateDepth() {
        depth = Math.floor(Math.random() * (12 - 4 + 1)) + 4
        return depth
    }

    function generateSeed() {
        const validChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ9'
        return Array.from(new Array(81), (x, i) => validChars[Math.floor(Math.random() * validChars.length)]).join('')
    }

    function generateTransfers() {
        return Array.from(new Array(numberOfTransfersInBundle), (x, i) => generateTransfer())
    }

    function generateTransfer() {
        return {
            address: spamAddress,
            value: 0,
            message: message,
            tag: tag
        }
    }

    function initializeIOTA() {
        eventEmitter.emitEvent('state', [`Initializing IOTA connection to ${getCurrentProvider()}`])
        iota = new iotaLib({'provider': getCurrentProvider()})
        curl.overrideAttachToTangle(iota.api)
    }

    function sendMessages() {        
        eventEmitter.emitEvent('state', [`Got ${tipTransactions.length} tips...`])
        eventEmitter.emitEvent('state', ['Searching for a non-zero value transaction...'])    
        findReattachableTransaction() 
    }
    
    function findReattachableTransaction(){
        var tip
        var value = 0
        while(value <= 1){
            if(tipTransactions.length == 0){
                populateTips()
                return
            }
            tip = tipTransactions.pop()
            value = tip.value
        }     
        iota.api.getBundle(tip.hash,function(error,bundle){
            if(error){
                findReattachableTransaction(tips)
                return
            }  
            var inputs = []
            for (var i=0; i < bundle.length; i++){
                if (bundle[i].value < 0) {
                    inputs.push(bundle[i].address)
                }
            }
            eventEmitter.emitEvent('state', ['Non-zero value transaction found!']) 
            eventEmitter.emitEvent('state', ['Checking if transaction is reattachable...'])
            iota.api.isReattachable(inputs,function(error,reattachable){
                if (error){
                    eventEmitter.emitEvent('state', ['Error checking if transaction is reattachable'])
                    checkIfNodeIsSynced()
                }
                if (typeof(reattachable) == 'object'){
                    var temp = true
                    for(var i=0; i<reattachable.length; i++){
                        if(!reattachable[i]) {
                            temp = false
                        }
                    }
                    reattachable = temp
                }
                if (reattachable){
                    reattachTransaction(bundle)
                }
                else{
                    eventEmitter.emitEvent('state', ['Not reattachable.'])
                    findReattachableTransaction()
                }
            })  
        })        
    }
    
    function reattachTransaction(bundle){
        eventEmitter.emitEvent('state', ['Reattaching transaction...'])
        iota.api.replayBundle(bundle[0].hash,3,15,function(error){
            if(error){
                eventEmitter.emitEvent('state', ['Error replaying bundle'])
                checkIfNodeIsSynced()
                return
            }
            transactionCount  += 1
            eventEmitter.emitEvent('state', ['Transaction reattached successfully.'])
            eventEmitter.emitEvent('transactionCountChanged', [transactionCount])
            eventEmitter.emitEvent('transactionCompleted', [bundle[0].bundle])
            checkTransaction(bundle,Date.now())
            if(optionsProxy.isLoadBalancing) {
                eventEmitter.emitEvent('state', ['Changing nodes to balance the load'])
                return changeProviderAndSync()
            }       
            checkIfNodeIsSynced()
        })
    }
    
    function checkTransaction(bundle,startTime){
        var inputs = []
        for (var i=0; i < bundle.length; i++){
            if (bundle[i].value < 0) {
                inputs.push(bundle[i].address)
            }
        }
        iota.api.isReattachable(inputs,function(error,reattachable){
            if (error){    
                eventEmitter.emitEvent('state', ['Error occurred while checking transactions'])      
                setTimeout(checkTransaction,60000,bundle,startTime)   
                return
            }
            if (typeof(reattachable) == 'object'){
                var temp = true
                for(var i=0; i<reattachable.length; i++){
                    if(!reattachable[i]) {
                        temp = false
                    }
                }
                reattachable = temp
            }   
            if (!reattachable){ 
                confirmationCount += 1
                var confirmationTime = Date.now()
                transactionDuration = (confirmationTime - startTime)/60
                confirmationTimes.push(transactionDuration)
                var sum = 0
                for (var i=0; i<confirmationTimes.length; i++){
                    sum += confirmationTimes[i]
                }
                averageConfirmationDuration = sum/confirmationTimes.length
                
                eventEmitter.emitEvent('confirmationCountChanged', [confirmationCount])
                eventEmitter.emitEvent('averageConfirmationDurationChanged', [averageConfirmationDuration])
                eventEmitter.emitEvent('state', [`Transaction confirmed`])
            }
            else{
                setTimeout(checkTransaction,60000,bundle,startTime)
            }
        })
    }
    
    function populateTips(){
        eventEmitter.emitEvent('state', ['Getting tip transactions... This may take a while...'])
        iota.api.getTips(function(error,success){
            if(error){
                eventEmitter.emitEvent('state', ['Error getting tips.'])
                return
            }
            tips = success
            tipTransactions = []
            tipIndex = 0 
            getTipTransactionObjects()
        })
    }
    
    function getTipTransactionObjects(){
        var tipSlice
        var done = false
        if((tipIndex + 100) > tips.length){
            tipSlice = tips.slice(tipIndex,tips.length)
            done = true
        }
        else{
            tipSlice = tips.slice(tipIndex,tipIndex + 100)
        }
        iota.api.getTransactionsObjects(tipSlice,function(error,success){
            if(error){
                eventEmitter.emitEvent('state', ['Error getting tips.'])
                return
            }
            for(var i=0; i<success.length; i++){
                tipTransactions.push(success[i])
            }
            tipIndex += 100
            if(!done){
                setTimeout(getTipTransactionObjects,100)
            }
            else{
                tipTransactions = shuffle(tipTransactions)
                restartSpamming()
            }
        })
    }
    
    function shuffle(array) {
        var m = array.length, t, i;

        // While there remain elements to shuffle…
        while (m) {

            // Pick a remaining element…
            i = Math.floor(Math.random() * m--);

            // And swap it with the current element.
            t = array[m];
            array[m] = array[i];
            array[i] = t;
        }
        return array;
    }

    function getRandomProvider() {
        return validProviders[Math.floor(Math.random() * validProviders.length)]
    }

    function changeProviderAndSync() {
        eventEmitter.emitEvent('state', ['Randomly changing IOTA nodes'])
        _currentProvider = getRandomProvider()
        eventEmitter.emitEvent('state', [`New IOTA node: ${getCurrentProvider()}`])
        restartSpamming()  
    }

    function checkIfNodeIsSynced() {
        eventEmitter.emitEvent('state', ['Checking if node is synced'])

        iota.api.getNodeInfo(function(error, success){
            if(error) {
                eventEmitter.emitEvent('state', ['Error occurred while checking if node is synced'])
                setTimeout(function(){
                    changeProviderAndSync()
                }, 1000)
                return
            }

            const isNodeUnsynced =
                success.latestMilestone == spamSeed ||
                success.latestSolidSubtangleMilestone == spamSeed ||
                success.latestSolidSubtangleMilestoneIndex < success.latestMilestoneIndex

            const isNodeSynced = !isNodeUnsynced

            if(isNodeSynced) {
                eventEmitter.emitEvent('state', ['Node is synced'])
                sendMessages()
            } else {
                const secondsBeforeChecking = 10
                eventEmitter.emitEvent('state', [`Node is not synced. Trying again in ${secondsBeforeChecking} seconds.`])
                setTimeout(function(){
                    changeProviderAndSync() // Sometimes the node stays unsynced for a long time, so change provider
                }, secondsBeforeChecking * 1000)
            }
        })
    }

    // Only call if there is an error or there is no current spamming running
    function restartSpamming() {
        eventEmitter.emitEvent('state', ['Restart transaction spamming'])
        initializeIOTA()
        checkIfNodeIsSynced()
    }

    // Helper for tritifying a URL.
    // WARNING: Not a perfect tritifier for URL's - only handles a few special characters
    function tritifyURL(urlString) {
        return urlString.replace(/:/gi, 'COLON').replace(/\./gi, 'DOT').replace(/\//gi, 'SLASH').replace(/-/gi, 'DASH').toUpperCase()
    }

    return {
        // Get options, or set options if params are specified
        options: function(params) {
            if(!params) {
                return {
                    provider: _currentProvider,
                    customProvider: customProvider,
                    depth: depth,
                    weight: weight,
                    spamSeed: spamSeed,
                    message: message,
                    tag: tag,
                    numberOfTransfersInBundle: numberOfTransfersInBundle,
                    isLoadBalancing: optionsProxy.isLoadBalancing
                }
            }
            if(params.hasOwnProperty("provider")) {
                _currentProvider = params.provider
                initializeIOTA()
            }
            if(params.hasOwnProperty("customProvider")) {
                customProvider = params.customProvider
                initializeIOTA()
            }
            if(params.hasOwnProperty("depth")) { depth = params.depth }
            if(params.hasOwnProperty("weight")) { weight = params.weight }
            if(params.hasOwnProperty("spamSeed")) { spamSeed = params.spamSeed }
            if(params.hasOwnProperty("message")) { message = params.message }
            if(params.hasOwnProperty("tag")) { tag = params.tag }
            if(params.hasOwnProperty("numberOfTransfersInBundle")) { numberOfTransfersInBundle = params.numberOfTransfersInBundle }
            if(params.hasOwnProperty("isLoadBalancing")) { optionsProxy.isLoadBalancing = params.isLoadBalancing }
        },
        startSpamming: function() {
            if(started) { return }
            started = true
            populateTips()
        },
        stopSpamming: function() {
            // TODO
            console.error("stopSpamming() NOT IMPLEMENTED")
        },
        tritifyURL: tritifyURL,
        eventEmitter: eventEmitter, // TODO: emit an event when the provider randomly changes due to an error
        getTransactionCount: () => transactionCount,
        getConfirmationCount: () => confirmationCount,
        getAverageConfirmationDuration: () => averageConfirmationDuration,
        httpProviders: httpProviders,
        httpsProviders: httpsProviders,
        validProviders: validProviders,
    }
})()