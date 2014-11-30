var Q = require('Q'),
	fs = require('fs'),
	readline = require('readline');

var db = function db() {}

function checkMetaData(db, metadata) {
	if(!metadata.keyField) throw "keyField in metadata not defined";
	if(!metadata.deleteField) metadata.deleteField = "__deleted__"; 

	db.system = {
		indexes : {},
		metadata : metadata
	};
}

function normaliseKey(key) {
	key = key.toLowerCase();
	key = key.replace(/\s+/g, ' ');
	return key;
}

db.prototype.loadFromFile = function(path, metadata, keyField) {

	checkMetaData(this, metadata)

	var data = {};
	var db = this;
	db.filePath = path;

	var rd = readline.createInterface({
	    input: fs.createReadStream(path),
	    output: process.stdout,
	    terminal: false
	}).on('line', function(line) {
	    var obj = JSON.parse(line);

	    if(obj[db.system.metadata.deleteField]) {
	    	delete data[obj[db.system.metadata.deleteField]]
	    } else {
	    	data[obj[keyField]] = obj;
	    }

	}).on('close', function() {
		db.loadData(data, metadata);
	}) 
}


db.prototype.loadData = function(data, metadata) {

	checkMetaData(this, metadata);
	
	this.data = data;

	var indexes = this.system.indexes;

	var promises = []

	

	if(metadata.indexes) {
		var indexKeys = Object.keys(metadata.indexes);
		for (var i = indexKeys.length - 1; i >= 0; i--) {
			var index = indexKeys[i];
			
			var promise = metadata.indexes[index](index, data).then(function(response) {
				if(!indexes[response.index]) {
					indexes[response.index] = {};
				}

				var objKeys = Object.keys(response.indexItems);
				for (var j = objKeys.length - 1; j >= 0; j--) {
					var key = objKeys[j];
					var normKey = normaliseKey(key);

					indexes[response.index][normKey] = indexes[response.index][normKey] || [];

					indexes[response.index][normKey].push(response.indexItems[key]);

				}

			}).done();
			promises.push(promise);
		
			
		};	
	}

	return Q.all(promises);
	
};

db.prototype.save = function(key, data, error, reindex) {
	var line = JSON.stringify(data)+'\n';

	var promises = [];

	if(data) {
		this.data[key] = data;
	} else {
		delete this.data[key];
		data = {};
		data[this.system.metadata.deleteField] = key;
	}

	var savePromise = Q.defer();
	promises.push(savePromise);
	fs.appendFile(this.filePath, line, function(err) {
		if(err) deferred.reject(err);
		else savePromise.resolve();
	})

	if(reindex) {
		promises.push(this.loadData(this.data, this.system.metadata));
	}
	
	return Q.all(promises);

}

db.prototype.delete = function(key, error) {
	this.update(key, undefined, error);
}

db.prototype.listKeys = function(forKey, options) {
	
	var deferred = Q.defer();

	var data;
	
	if(this.system[forKey]) {
		data = Object.keys(this.system[forKey]);
	} else if (this.system.indexes[forKey]) {
		data = Object.keys(this.system.indexes[forKey]);
	} else if(this.data[forKey]) {
		data = Object.keys(this.data[forKey]);
	} else {
		deferred.reject("no data for " + forKey);
		return deferred.promise;
	}

	if(data && options && options.sort && this.system.metadata.indexes[forKey] && this.system.metadata.indexes[forKey].sort) {
		data.sort(this.system.metadata.indexes[forKey].sort);

		if(options.sort == -1) {
			data.reverse();
		}
	}

	if(options && options.limit) {
		options.offset = options.offset || 0;

		data = data.slice(options.offset, options.offset+options.limit);
	}

	if(options && options.hydrate) {
		var hydrated = [];

		for (var i = 0; i < data.length; i++) {

			var x = this.system.indexes[forKey][data[i]];

			for (var j = 0; j < x.length; j++) {
				
				var y = x[j];

				for (var k = 0; k < y.length; k++) {
					hydrated.push(y[k]);
				};
			};
			
		};

		data = hydrated;
	}

	deferred.resolve(data);

	return deferred.promise;
};

db.prototype.get = function(index, key) {
	var deferred = Q.defer();
	key = normaliseKey(key);
	deferred.resolve({ key : key, indexItems : this.system.indexes[index][key]});
	return deferred.promise;
}

db.prototype.search = function(index, input, keyField, limit) {
	var deferred = Q.defer();

	if(!input || !index) {
		deferred.reject("no input or index");
	}

	var searchDb = this;
	
	// create trigram search
	var q = { indexItems : {} };
	q.indexItems[input] = 1;

	db.prototype.indexBuilders.trigramFromIndex(undefined, q)
	.then(function(data) {

		var promises = [];
		var rankingMap = {};
		var keyMap = {};

		var keys = Object.keys(data.indexItems);
		for (var i = keys.length - 1; i >= 0; i--) {
			var key = keys[i];
			var promise = searchDb.get(index, key)
			.then(function(data) {
				var key = data.key;
				data = data.indexItems;
				if(!data) return;
				for (var k = data.length - 1; k >= 0; k--) {
					for (var j = data[k].length - 1; j >= 0; j--) {
						var obj = data[k][j][0];
						var objKey = obj[keyField];
						keyMap[objKey] = obj;
						
						if(!rankingMap[objKey]) rankingMap[objKey] = [];
						rankingMap[objKey].push(key); 
					};
				};
				
			}).done()

			promises.push(promise);
		};

		Q.all(promises)
		.then(function() {

			var compare = function compare(a,b) {
				if (a.count > b.count)
					return 1;
				if (a.count < b.count)
					return -1;
				
				if (a.key.length > b.key.length)
					return -1;
				if (a.key.length < b.key.length)
					return 1;

				return 0;
				
			}

			var toSort = []
			var keys = Object.keys(rankingMap);
			for (var i = keys.length - 1; i >= 0; i--) {
				var key = keys[i];
				toSort.push(
					{ key : key, count : rankingMap[key].length }
				);
			};

			toSort.sort(compare);

			var toReturn = [];

			for (var i = toSort.length - 1; i >= 0; i--) {
				toReturn.push(
					keyMap[toSort[i].key]
				);
			};

			if(limit) {
				//options.offset = options.offset || 0;

				toReturn = toReturn.slice(0, limit);
			}

			deferred.resolve({index: index, indexItems: toReturn });	
		})
		
	})

	
	return deferred.promise;
}

db.prototype.indexBuilders = {
	trigramFromIndex : function(index, data) {
		var defered = Q.defer();
		var toReturn = {};

		var keys = Object.keys(data.indexItems);
		for (var i = keys.length - 1; i >= 0; i--) {
			var key = keys[i];
			var offset = 0;
			var keySize = 3;

			if(key.length < keySize) {
				if(!toReturn[key]) toReturn[key] = []
				toReturn[key].push(data.indexItems[key]);
			} else {

				while (offset + keySize < key.length + 1) {
					var v = key.substring(offset, offset + keySize);
					
					if(!toReturn[v]) toReturn[v] = []

					toReturn[v].push(data.indexItems[key]);
					offset++;
				}
			}
		};


		defered.resolve( {index: index, indexItems: toReturn } );
		return defered.promise;
	},
	fromField : function(index, data, fn) {
		var defered = Q.defer();
		var toReturn = {};
		var objKeys = Object.keys(data);
		for (var i = objKeys.length - 1; i >= 0; i--) {
			var key = objKeys[i];
			var obj = data[key];

			try {
				var fieldData = fn(obj);

				if(typeof fieldData === 'object') {
					var fieldKeys = Object.keys(fieldData);
					for (var j = fieldKeys.length - 1; j >= 0; j--) {
						var fieldKey = fieldKeys[j];
						toReturn[fieldKey] = toReturn[fieldKey] || [];
						toReturn[fieldKey].push(data[key]);
					};
				} else if(typeof fieldData === 'array') {
					for (var j = fieldData.length - 1; j >= 0; j--) {
						var fieldKey = fieldData[j];
						toReturn[fieldKey] = toReturn[fieldKey] || [];
						toReturn[fieldKey].push(data[key]);
					};
				} else if(typeof fieldData === 'number' || typeof fieldData === 'string') {
					var fieldKey = fieldData;
					toReturn[fieldKey] = toReturn[fieldKey] || [];
					toReturn[fieldKey].push(data[key]);
				}
			} catch (e){}
		}

		defered.resolve( {index: index, indexItems: toReturn });
		return defered.promise;

	},
	fromKey : function(index, data) {
		var defered = Q.defer();

		var toReturn = {};

		var objKeys = Object.keys(data);
		for (var i = objKeys.length - 1; i >= 0; i--) {
			var key = objKeys[i];
			toReturn[key] = [
				data[key]
			]
		}

		defered.resolve( {index: index, indexItems: toReturn });
		return defered.promise;
	},
	fromAlias : function(index, data) {
		var defered = Q.defer();

		var items = {};

		var objKeys = Object.keys(data);
		for (var i = objKeys.length - 1; i >= 0; i--) {
			var index = objKeys[i]
			var value =  data[index];

			items[index] = value;

			if(data[index] && data[index].alias) {
				for (var j = data[index].alias.length - 1; j >= 0; j--) {
					var alias = data[index].alias[j];
					items[alias] = value;
				};
				
			}
		};
		defered.resolve( {index: index, indexItems: items });

		return defered.promise;
	},
	fromRecursive : function(index, data, property) {

//IM NOT DOING THIS RIGHT - EITHER IT NEEDS TO BE ONE CONTINUOUS RECURSIVE PROCESS OR SOMETHING ELSE.

		var defered = Q.defer();

		function recurse(data, property, items) {
		
			var objKeys = Object.keys(data);
			for (var i = objKeys.length - 1; i >= 0; i--) {
				var index = objKeys[i]
				var value =  data[index];

				items[index] = value;
				
				
				if(data[index] && data[index][property]) {
					recurse( data[index][property] , property, items);
				} 
			}
		}
		var items = {};
		recurse(data, property, items);
		console.log("what?")
		console.log(items);
		defered.resolve( { index : index, indexItems : items });
		return defered.promise;
	}
};


module.exports = {
	create : function(){ return new db(); },
	indexBuilders : db.prototype.indexBuilders
};