var Utils              = require('../../utils')
  , CustomEventEmitter = require("../../emitters/custom-event-emitter")

module.exports = (function() {
  var AbstractQuery = function(database, sequelize, callee, options) {}

  /**
    Inherit from CustomEventEmitter
  */
  Utils.inherit(AbstractQuery, CustomEventEmitter)

  /**
   * Execute the passed sql query.
   *
   * Examples:
   *
   *     query.run('SELECT 1')
   *
   * @param {String} sql - The SQL query which should be executed.
   * @api public
   */
  AbstractQuery.prototype.run = function(sql) {
    throw new Error("The run method wasn't overwritten!")
  }

  /**
   * Check the logging option of the instance and print deprecation warnings.
   *
   * @return {void}
   */
  AbstractQuery.prototype.checkLoggingOption = function() {
    if (this.options.logging === true) {
      console.log('DEPRECATION WARNING: The logging-option should be either a function or false. Default: console.log')
      this.options.logging = console.log
    }

    if (this.options.logging === console.log) {
      // using just console.log will break in node < 0.6
      this.options.logging = function(s) { console.log(s) }
    }
  }

  /**
   * High level function that handles the results of a query execution.
   *
   *
   * Example:
   *  query.formatResults([
   *    {
   *      id: 1,              // this is from the main table
   *      attr2: 'snafu',     // this is from the main table
   *      Tasks.id: 1,        // this is from the associated table
   *      Tasks.title: 'task' // this is from the associated table
   *    }
   *  ])
   *
   * @param {Array} data - The result of the query execution.
   */
  AbstractQuery.prototype.formatResults = function(data) {
    var result  = this.callee

    if (isInsertQuery.call(this, data)) {
      handleInsertQuery.call(this, data)
    }

    if (isSelectQuery.call(this)) {
      result = handleSelectQuery.call(this, data)
    } else if (isShowTableQuery.call(this)) {
      result = handleShowTableQuery.call(this, data)
    } else if (isShowOrDescribeQuery.call(this)) {
      result = data
    } else if (isCallQuery.call(this)) {
      result = data[0]
    }

    return result
  }

  /**
    Shortcut methods (success, ok) for listening for success events.

    Params:
      - fct: A function that gets executed once the *success* event was triggered.

    Result:
      The function returns the instance of the query.
  */
  AbstractQuery.prototype.success =
  AbstractQuery.prototype.ok =
  function(fct) {
    this.on('success', fct)
    return this
  }

  /**
    Shortcut methods (failure, fail, error) for listening for error events.

    Params:
      - fct: A function that gets executed once the *error* event was triggered.

    Result:
      The function returns the instance of the query.
  */
  AbstractQuery.prototype.failure =
  AbstractQuery.prototype.fail =
  AbstractQuery.prototype.error =
  function(fct) {
    this.on('error', fct)
    return this
  }

  /**
   * This function is a wrapper for private methods.
   *
   * @param {String} fctName The name of the private method.
   *
   */
  AbstractQuery.prototype.send = function(fctName/*, arg1, arg2, arg3, ...*/) {
    var args = Array.prototype.slice.call(arguments).slice(1)
    return eval(fctName).apply(this, args)
  }

  /**
   * Get the attributes of an insert query, which contains the just inserted id.
   *
   * @return {String} The field name.
   */
  AbstractQuery.prototype.getInsertIdField = function() {
    return 'insertId'
  }

  /////////////
  // private //
  /////////////

  /**
   * Iterate over all known tables and search their names inside the sql query.
   * This method will also check association aliases ('as' option).
   *
   * @param  {String} attribute An attribute of a SQL query. (?)
   * @return {String}           The found tableName / alias.
   */
  var findTableNameInAttribute = function(attribute) {
    var tableName = null

    this.sequelize.daoFactoryManager.daos.forEach(function(daoFactory) {
      if (!!tableName) {
        return
      } else if (attribute.indexOf(daoFactory.tableName + ".") === 0) {
        tableName = daoFactory.tableName
      } else if (attribute.indexOf(Utils.singularize(daoFactory.tableName) + ".") === 0) {
        tableName = Utils.singularize(daoFactory.tableName)
      } else {
        for (var associationName in daoFactory.associations) {
          if (daoFactory.associations.hasOwnProperty(associationName)) {
            var association = daoFactory.associations[associationName]

            if (attribute.indexOf(association.options.as + ".") === 0) {
              tableName = association.options.as
            }
          }
        }
      }
    })

    return tableName
  }

  var queryResultHasJoin = function(results) {
    if (!!results[0]) {
      var keys = Object.keys(results[0])

      for (var i = 0; i < keys.length; i++) {
        if (!!findTableNameInAttribute.call(this, keys[i])) {
          return true
        }
      }
    }

    return false
  }

  var isInsertQuery = function(results, metaData) {
    var result = true

    // is insert query if sql contains insert into
    result = result && (this.sql.toLowerCase().indexOf('insert into') === 0)

    // is insert query if no results are passed or if the result has the inserted id
    result = result && (!results || results.hasOwnProperty(this.getInsertIdField()))

    // is insert query if no metadata are passed or if the metadata has the inserted id
    result = result && (!metaData || metaData.hasOwnProperty(this.getInsertIdField()))

    return result
  }

  var handleInsertQuery = function(results, metaData) {
    if (this.callee) {
      // add the inserted row id to the instance
      var autoIncrementField = this.callee.__factory.autoIncrementField
        , id                 = null

      id = id || (results && results[this.getInsertIdField()])
      id = id || (metaData && metaData[this.getInsertIdField()])

      this.callee[autoIncrementField] = id
    }
  }

  var isShowTableQuery = function() {
    return (this.sql.toLowerCase().indexOf('show tables') === 0)
  }

  var handleShowTableQuery = function(results) {
    return Utils._.flatten(results.map(function(resultSet) {
      return Utils._.values(resultSet)
    }))
  }

  var isSelectQuery = function() {
    return this.options.type === 'SELECT';
  }

  var isUpdateQuery = function() {
    return (this.sql.toLowerCase().indexOf('update') === 0)
  }

  var handleSelectQuery = function(results) {
    var result = null, self = this;

    if (this.options.raw) {
      result = results
    } else if (this.options.hasJoin === true) {
      result = prepareJoinData.call(this, results)
      result = groupDataByCalleeFactory.call(this, result).map(function(result) {
        // let's build the actual dao instance first...
        var dao = this.callee.build(result[this.callee.tableName], { isNewRecord: false })

        // ... and afterwards the prefetched associations
        for (var tableName in result) {
          if (result.hasOwnProperty(tableName) && (tableName !== this.callee.tableName)) {
            buildAssociatedDaoInstances.call(this, tableName, result[tableName], dao)
          }
        }

        return dao
      }.bind(this))
    } else {
      result = results.map(function(result) {
        return this.callee.build(result, { isNewRecord: false })
      }.bind(this))
    }
    
    // return the first real model instance if options.plain is set (e.g. Model.find)
    if (this.options.plain) {
      result = (result.length === 0) ? null : result[0]
    }

    return result
  }

  var buildAssociatedDaoInstances = function(tableName, associationData, dao) {
    var associatedDaoFactory = this.sequelize.daoFactoryManager.getDAO(tableName, { attribute: 'tableName' })
      , association          = null

    if (!!associatedDaoFactory) {
      association = this.callee.getAssociation(associatedDaoFactory)
    } else {
      associatedDaoFactory = this.sequelize.daoFactoryManager.getDAO(Utils.pluralize(tableName), { attribute: 'tableName' })

      if (!!associatedDaoFactory) {
        association = this.callee.getAssociation(associatedDaoFactory)
      } else {
        association          = this.callee.getAssociationByAlias(tableName)
        associatedDaoFactory = association.target
      }
    }

    var accessor = Utils._.camelize(tableName)

    // downcase the first char
    accessor = accessor.slice(0,1).toLowerCase() + accessor.slice(1)

    associationData.forEach(function(data) {
      var daoInstance = associatedDaoFactory.build(data, { isNewRecord: false })
        , isEmpty = ! Utils.firstValueOfHash(daoInstance.identifiers)

      if (['BelongsTo', 'HasOne'].indexOf(association.associationType) > -1) {
        accessor = Utils.singularize(accessor)
        dao[accessor] = isEmpty ? null : daoInstance
      } else {
        dao[accessor] = dao[accessor] || []
        if (! isEmpty)
          dao[accessor].push(daoInstance)
      }
    })
  }

  var isShowOrDescribeQuery = function() {
    var result = false

    result = result || (this.sql.toLowerCase().indexOf('show') === 0)
    result = result || (this.sql.toLowerCase().indexOf('describe') === 0)

    return  result
  }

  var isCallQuery = function() {
    var result = false

    result = result || (this.sql.toLowerCase().indexOf('call') === 0)

    return result
  }


  /**
    The function takes the result of the query execution and groups
    the associated data by the callee.

    Example:
      groupDataByCalleeFactory([
        {
          callee: { some: 'data', id: 1 },
          association: { foo: 'bar', id: 1 }
        }, {
          callee: { some: 'data', id: 1 },
          association: { foo: 'bar', id: 2 }
        }, {
          callee: { some: 'data', id: 1 },
          association: { foo: 'bar', id: 3 }
        }
      ])

    Result:
      Something like this:

      [
        {
          callee:  { some: 'data', id: 1 },
          association: [
            { foo: 'bar', id: 1 },
            { foo: 'bar', id: 2 },
            { foo: 'bar', id: 3 }
          ]
        }
      ]
  */
  var groupDataByCalleeFactory = function(data) {
    var result          = []
      , calleeTableName = this.callee.tableName

    data.forEach(function(row) {
      var calleeData    = row[calleeTableName]
        , existingEntry = result.filter(function(groupedRow) {
            return Utils._.isEqual(groupedRow[calleeTableName], calleeData)
          })[0]

      if (!existingEntry) {
        existingEntry = {}
        result.push(existingEntry)
        existingEntry[calleeTableName] = calleeData
      }

      for (var attrName in row) {
        if (row.hasOwnProperty(attrName) && (attrName !== calleeTableName)) {
          existingEntry[attrName] = existingEntry[attrName] || []
          existingEntry[attrName].push(row[attrName])
        }
      }
    })

    return result
  }


  /**
   * This function will prepare the result of select queries with joins.
   *
   * @param  {Array} data This array contains objects.
   * @return {Array}      The array will have the needed format for groupDataByCalleeFactory.
   */
  var prepareJoinData = function(data) {
    var result = data.map(function(row) {
      var nestedRow = {}

      for (var key in row) {
        if (row.hasOwnProperty(key)) {
          var tableName = findTableNameInAttribute.call(this, key)

          if (!!tableName) {
            nestedRow[tableName] = nestedRow[tableName] || {}
            nestedRow[tableName][key.replace(tableName + '.', '')] = row[key]
          } else {
            nestedRow[this.callee.tableName] = nestedRow[this.callee.tableName] || {}
            nestedRow[this.callee.tableName][key] = row[key]
          }
        }
      }

      return nestedRow
    }.bind(this))

    return result
  }

  return AbstractQuery
})()
